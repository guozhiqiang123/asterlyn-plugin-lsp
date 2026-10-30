import {spawn} from "node:child_process";
import {readFile, realpath, mkdir, rm, stat} from "node:fs/promises";
import {join, isAbsolute, relative, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {RpcPeer} from "./rpc.mjs";
import {createJavaModel, prepareJdt} from "./java-model.mjs";
import {prepareAndroidKotlin} from "./android-kotlin.mjs";

const host = new RpcPeer(process.stdin, process.stdout);
const documents = new Map();
let options, backend, child, languageContext, stateDirectory, modelGeneration = null;
let workspaceRoot, sourceDirectories = [], backendReady = false;
let loading = null, poll, closed = false, indexing = true, epoch = 0, revision = 0, active = 0;
let overlayQueue = Promise.resolve(), overlayPending = 0, needsRefresh = false, repairAt = 0;
let lastStatus = "";
let retryAt = 0, failureCount = 0;
let debugTracing=false,progress={phase:"model"},lastFailure=null,forceModel=false;
const hash = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const errorCode = error => /^[a-z][a-z0-9.-]{1,80}$/u.test(error?.message) ? error.message : "backend-failed";
function status(ready, health = "ok", code) {
  const params = {health, quiescent: ready, ...(code ? {code} : {}),progress};
  if (JSON.stringify(params) !== lastStatus) {lastStatus = JSON.stringify(params); host.notify("experimental/serverStatus", params);}
}
function trace(code,details={}){if(debugTracing)host.notify("asterlyn/trace",{code,details});}
function stage(value){progress=value;status(!indexing);}
function failure(error) {
  indexing = true; revision++; const code = errorCode(error);
  lastFailure=code;progress={phase:"failed"};trace(code,{attempt:failureCount+1});
  failureCount++; retryAt = Date.now() + Math.min(300000, 10000 * 2 ** Math.min(failureCount, 5));
  status(false, "error", code);
  if (["android-compile-artifact-missing", "model-integrity"].includes(code) && Date.now() - repairAt > 30000) {needsRefresh = true; repairAt = Date.now();}
}
function document(uri) {const doc = documents.get(uri); if (!doc) throw Error("document-not-open"); return doc;}
function offset(text, position) {
  let start = 0;
  for (let line = 0; line < position.line; line++) {start = text.indexOf("\n", start); if (start < 0) throw Error("invalid-position"); start++;}
  return start + position.character;
}
function update(params) {
  const doc = document(params.textDocument.uri);
  for (const change of params.contentChanges) {
    if (change.range) {const from = offset(doc.text, change.range.start), to = offset(doc.text, change.range.end); doc.text = doc.text.slice(0, from) + change.text + doc.text.slice(to);}
    else doc.text = change.text;
  }
  doc.version = params.textDocument.version;
}
function refreshDiagnostics() {if (!closed) void host.request("workspace/diagnostic/refresh", null, 3000).catch(() => {});}
function queueOverlay(uri, doc, closing = false) {
  overlayPending++; const captured = doc && {...doc}, context = languageContext;
  overlayQueue = overlayQueue.catch(() => {}).then(async () => {
    if (!context || context !== languageContext) return;
    if (closing) await context.closeOverlay(uri);
    else {await context.applyOverlay(uri, captured); if(context === languageContext)await context.startIfNeeded();}
  }).finally(() => {overlayPending--;}).catch(error => {if (!closed && context === languageContext) status(!indexing,"warning",errorCode(error));});
  return overlayQueue;
}
async function canonical(value, budget = {bytes: 0}, documentUri) {
  if (Array.isArray(value)) {const result = []; for (const item of value) result.push(await canonical(item, budget, documentUri)); return result;}
  if (!value || typeof value !== "object") return value;
  const target = value.targetUri ?? value.uri;
  if (typeof target === "string" && target.startsWith("file:")) {
    const targetPath = await realpath(fileURLToPath(target));
    const canonicalTarget=pathToFileURL(targetPath).href;
    const origin = await languageContext?.mapJavaDefinition({uri:canonicalTarget,range:value.targetSelectionRange??value.range??value.targetRange}, backend);
    if (origin) return origin;
    const inside = root => {const path = relative(root, targetPath); return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));};
    if (!inside(workspaceRoot)) {
      const preview = documentUri && await languageContext?.readDependencySource(canonicalTarget, documentUri);
      if (preview) {
        if ((budget.bytes += Buffer.byteLength(preview.text)) > 2 * 1024 * 1024) throw Error("dependency-source-bound");
        const uri = `asterlyn-source://${hash(preview.text).slice(7)}/${encodeURIComponent(preview.path)}`;
        return {...value, ...(value.targetUri ? {targetUri: uri} : {uri}), readonlySource: preview};
      }
      if (!sourceDirectories.some(inside)) throw Error("dependency-source-not-admitted");
      const metadata = await stat(targetPath);
      if (!metadata.isFile() || metadata.size > 512 * 1024) throw Error("dependency-source-bound");
      const text = await readFile(targetPath, "utf8");
      if ((budget.bytes += Buffer.byteLength(text)) > 2 * 1024 * 1024) throw Error("dependency-source-bound");
      const path = targetPath.split(sep).at(-1);
      if (!/^[\w$.-]{1,200}\.java$/u.test(path)) throw Error("dependency-source-label");
      const uri = `asterlyn-source://${hash(text).slice(7)}/${encodeURIComponent(path)}`;
      return {...value, ...(value.targetUri ? {targetUri: uri} : {uri}), readonlySource: {text, path, languageId: "java"}};
    }
  }
  if (typeof target === "string" && target.startsWith("jdt:")) {
    const text = await backend.request("java/classFileContents", {uri: target});
    if (typeof text !== "string" || Buffer.byteLength(text) > 512 * 1024 || (budget.bytes += Buffer.byteLength(text)) > 2 * 1024 * 1024) throw Error("dependency-source-bound");
    const path = decodeURIComponent(new URL(target).pathname.split("/").at(-1)).replace(/\.class$/u, ".java");
    if (!/^[\w$.-]{1,200}\.java$/u.test(path)) throw Error("dependency-source-label");
    const uri = `asterlyn-source://${hash(text).slice(7)}/${encodeURIComponent(path)}`;
    return {...value, ...(value.targetUri ? {targetUri: uri} : {uri}), readonlySource: {text, path, languageId: "java"}};
  }
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key,
    (key === "uri" || key === "targetUri") && typeof item === "string" && item.startsWith("file:")
      ? pathToFileURL(await realpath(fileURLToPath(item))).href : await canonical(item, budget, documentUri)])));
}
async function stopBackend() {
  const previous = child, context = languageContext, directory = stateDirectory;
  backendReady = false; backend?.close(); backend = null; child = null; languageContext = null; stateDirectory = null;
  await context?.close();
  if (previous) {previous.kill("SIGTERM"); await Promise.race([new Promise(resolve => previous.once("close", resolve)), pause(1500)]); if (previous.exitCode === null && previous.signalCode === null) previous.kill("SIGKILL");}
  if (directory) await rm(directory, {recursive: true, force: true});
}
async function load(refresh = false) {
  if (loading || closed || (!refresh && Date.now() < retryAt)) return loading;
  const own = ++epoch;
  loading = (async () => {
    if(!backend){lastFailure=null;stage({phase:"model"});}
    const reference = await host.request("asterlyn/workspaceModel", {refresh: refresh || needsRefresh || forceModel}, 315000); needsRefresh = false;forceModel=false;
    if (closed || own !== epoch) return;
    if (reference?.schema !== 1 || !Number.isSafeInteger(reference.generation) || !isAbsolute(reference.path) || reference.bytes > 8 * 1024 * 1024) throw Error("invalid-model-reference");
    if (reference.generation === modelGeneration && backend) {
      if (await languageContext?.refreshSources()) {revision++; refreshDiagnostics();}
      return;
    }
    indexing = true; revision++; status(false, "ok", "preparing-language-model");
    stage({phase:"sources"});trace("model-ready",{bytes:reference.bytes,version:reference.generation});
    const metadata = await stat(reference.path); if (!metadata.isFile() || metadata.size !== reference.bytes) throw Error("model-integrity");
    const bytes = await readFile(reference.path); if (bytes.length !== reference.bytes || hash(bytes) !== reference.digest) throw Error("model-integrity");
    const model = JSON.parse(bytes); await stopBackend();
    workspaceRoot = await realpath(model.buildRoot);
    sourceDirectories = [];
    for (const module of model.modules ?? []) for (const attachment of module.sourceAttachments ?? []) {
      for (const source of attachment.sources ?? [attachment.source]) {
        if (typeof source !== "string" || !isAbsolute(source)) continue;
        const path = await realpath(source); if ((await stat(path)).isDirectory()) sourceDirectories.push(path);
      }
    }
    const state = stateDirectory = join(options.stateDirectory, `model-${reference.generation}`); await mkdir(state, {recursive: true});
    let partialJava = false;
    if (options.components["kotlin-compiler-bridge"]) {
      languageContext = await prepareAndroidKotlin({model, stateDirectory: state, options, documents: new Map([...documents].map(([uri, doc]) => [uri, {...doc}])),
        onProgress:value=>{if(!closed)stage(value);},trace,
        onBackendReady: () => {if(!closed){if(!indexing)progress={phase:languageContext?.backendPending()?"backend":"ready"};status(!indexing);}},
        onJavaAbiReady: () => {if (!closed && backendReady) {if(!languageContext?.backendPending())progress={phase:"ready"};status(!indexing); refreshDiagnostics();}},
        onDiagnostics: params => {const doc = documents.get(params?.uri); if (!overlayPending && doc?.version === params?.version && Array.isArray(params.diagnostics)) {host.notify("textDocument/publishDiagnostics", params);}},
        onChanged: async changes => {if (!backendReady) return; backend.notify("workspace/didChangeWatchedFiles", {changes: changes.map(item => typeof item === "string" ? {uri: item, type: 2} : item)}); await backend.request("workspace/executeCommand", {command: "asterlyn.java.refreshModel", arguments: []}); if(!indexing)status(true);refreshDiagnostics();}, onError: error => {if(closed)return;trace(errorCode(error),{backend:"kotlin"});if(error?.message==="kotlin-backend-exited"){progress={phase:"failed"};refreshDiagnostics();}status(!indexing,"warning",error?.message==="kotlin-backend-exited"?"kotlin-backend-exited":"java-analysis-awaiting-kotlin");}});
      try {await languageContext.awaitJavaAbi();} catch {partialJava = true;}
    }
    const view = await createJavaModel(model, state, languageContext?.extraSources), java = options.tools?.serverJava?.java, jdt = options.components?.jdtls?.root;
    if (!isAbsolute(java) || !isAbsolute(jdt)) throw Error("analysis-components-unavailable");
    const launch = await prepareJdt(jdt, state);
    stage({phase:"backend"});trace("java-started",{backend:"java"});
    child = spawn(java, ["-Xmx1024m", "-Declipse.application=org.eclipse.jdt.ls.core.id1", "-Dosgi.bundles.defaultStartLevel=4", "-Declipse.product=org.eclipse.jdt.ls.core.product", "--add-modules=ALL-SYSTEM", "--add-opens", "java.base/java.util=ALL-UNNAMED", "--add-opens", "java.base/java.lang=ALL-UNNAMED", "-jar", launch.launcher, "-configuration", launch.configuration, "-data", launch.data], {cwd: state, env: {HOME: process.env.HOME, PATH: join(options.tools.serverJava.home, "bin"), JAVA_HOME: options.tools.serverJava.home, TMPDIR: process.env.TMPDIR}, stdio: ["pipe", "pipe", "pipe"]});
    const peer = backend = new RpcPeer(child.stdout, child.stdin); child.stderr.on("data", () => {});
    child.on("error", () => {if (backend === peer) {backendReady = false; failure(Error("java-backend-start-failed"));}});
    child.on("exit", () => {if (!closed && backend === peer) {backendReady = false; backend = null; peer.close(); failure(Error("java-backend-exited"));}});
    peer.on("fatal", () => {void stopBackend(); failure(Error("java-backend-protocol-failed"));});
    const settings = {java: {autobuild: {enabled: false}, import: {gradle: {enabled: false}, maven: {enabled: false}}, project: {importOnFirstTimeStartup: "automatic"}}};
    peer.on("request", request => {
      if (request.method === "workspace/configuration") peer.reply(request.id, (request.params?.items ?? []).slice(0, 64).map(item => item.section ? item.section.split(".").reduce((value, key) => value?.[key], settings) ?? null : settings));
      else if (request.method === "workspace/applyEdit") peer.reply(request.id, {applied: false});
      else if (["window/workDoneProgress/create", "window/showMessageRequest", "workspace/diagnostic/refresh", "client/registerCapability", "client/unregisterCapability"].includes(request.method)) peer.reply(request.id, null);
      else peer.reject(request.id, -32601);
    });
    const ready = new Promise((resolve, reject) => {const timer = setTimeout(() => reject(Error("java-import-timeout")), 90000); peer.on("notification", notification => {if (notification.method === "language/status" && notification.params?.type === "Started") {clearTimeout(timer); resolve();}}); peer.once("closed", () => {clearTimeout(timer); reject(Error("java-backend-closed"));});}); ready.catch(() => {});
    const folders = view.projects.map(path => ({uri: pathToFileURL(path).href, name: path.split(/[\\/]/u).at(-1)}));
    await peer.request("initialize", {processId: process.pid, rootUri: folders[0].uri, workspaceFolders: folders, capabilities: {general: {positionEncodings: ["utf-16"]}, workspace: {configuration: true, workspaceFolders: true, applyEdit: false}, textDocument: {definition: {linkSupport: false}}, window: {workDoneProgress: true}}, initializationOptions: {settings, workspaceFolders: folders.map(folder => folder.uri), bundles: [fileURLToPath(new URL("./java-bridge.jar", import.meta.url))], extendedClientCapabilities: {classFileContentsSupport: true, progressReportProvider: true}}}, 60000);
    peer.notify("initialized", {});stage({phase:"indexing"}); await ready;trace("java-ready",{backend:"java"});
    if (closed || own !== epoch) {await stopBackend(); return;}
    backendReady = true;
    for (const [uri, doc] of documents) if (doc.languageId === "java") peer.notify("textDocument/didOpen", {textDocument: {uri, languageId: "java", version: doc.version, text: doc.text}});
    if(languageContext)for(const [uri,doc]of documents)await languageContext.applyOverlay(uri,{...doc});
    modelGeneration=reference.generation;indexing=false;lastFailure=null;
    stage({phase:"backend"});status(true,"warning","java-analysis-awaiting-kotlin");
    let kotlinFailure=false;
    await languageContext?.warmProject().catch(error=>{kotlinFailure=true;trace(errorCode(error),{backend:"kotlin"});});
    progress={phase:kotlinFailure||partialJava?"failed":"ready"};failureCount=0;retryAt=0;
    status(true,kotlinFailure||partialJava?"warning":"ok",kotlinFailure?"kotlin-backend-unavailable":partialJava?"java-analysis-awaiting-kotlin":undefined);refreshDiagnostics();
  })().catch(error => {if (!closed) failure(error);}).finally(() => {loading = null;});
  return loading;
}
async function diagnostics(uri, doc, version) {
  if (doc.languageId === "kotlin") {
    const context = languageContext, current = revision;
    const report = await context.documentDiagnostics(uri);
    if (context !== languageContext || current !== revision || overlayPending || documents.get(uri) !== doc || doc.version !== version || report.version !== version) throw Error("stale-diagnostics");
    host.notify("textDocument/publishDiagnostics", report);
    return {kind: "full", items: report.diagnostics};
  }
  // Syntax diagnostics depend on the current Java working copy only. Keep them responsive while
  // Kotlin ABI is rebuilding; type diagnostics wait until that exact ABI revision is committed.
  const syntaxOnly = languageContext?.javaAbiCurrent() === false;
  const digest = hash(doc.text), peer = backend;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (doc.version !== version || backend !== peer) throw Error("stale-diagnostics");
    try {const reply = await peer.request("workspace/executeCommand", {command: "asterlyn.java.documentDiagnostics", arguments: [{uri, version, digest, syntaxOnly}]}); if (reply.version !== version || reply.digest !== digest || hash(doc.text) !== digest) throw Error("stale-diagnostics"); if (syntaxOnly) status(!indexing, "warning", "java-analysis-awaiting-kotlin"); return {kind: "full", items: reply.items};}
    catch {if (attempt === 39) throw Error("working-copy-not-current"); await pause(50);}
  }
}
host.on("request", async request => {
  if (++active > 64) {active--; host.reject(request.id, -32000); return;}
  try {
    if (request.method === "initialize") {options = request.params?.initializationOptions?.analysis; if (!isAbsolute(options?.stateDirectory)) throw Error("analysis-options"); debugTracing=options.debugTrace===true;forceModel=options.refreshModel===true;options.stateDirectory=await realpath(options.stateDirectory);host.reply(request.id, {capabilities: {positionEncoding: "utf-16", textDocumentSync: {openClose: true, change: 2}, definitionProvider: true, referencesProvider: true, hoverProvider: true, completionProvider: {triggerCharacters: ["."]}, diagnosticProvider: {interFileDependencies: true, workspaceDiagnostics: false}}, serverInfo: {name: "Asterlyn Android language adapter", version: "1"}}); return;}
    if (request.method === "shutdown") {closed = true; clearInterval(poll); await stopBackend(); host.reply(request.id, null); return;}
    // More notifications can arrive while an earlier overlay is awaited. Drain the current queue
    // before capturing the request's analysis revision, rather than observing a half-applied batch.
    let queued; do {queued = overlayQueue; await queued;} while (queued !== overlayQueue);
    if (!backend || indexing) throw Error(lastFailure??"android-indexing");
    const params = request.params, doc = document(params?.textDocument?.uri), version = doc.version, current = revision;
    if(doc.languageId==="kotlin"&&!languageContext?.readyFor(params.textDocument.uri)){
      void languageContext?.startIfNeeded(params.textDocument.uri).catch(error=>{progress={phase:"failed"};trace(errorCode(error),{backend:"kotlin"});status(!indexing,"warning","kotlin-backend-unavailable");});throw Error("android-indexing");
    }
    let result;
    if (request.method === "textDocument/diagnostic") result = await diagnostics(params.textDocument.uri, doc, version);
    else {
      if (!["textDocument/definition", "textDocument/references", "textDocument/hover", "textDocument/completion"].includes(request.method)) throw Error("unsupported-method");
      if (doc.languageId === "kotlin") result = await languageContext.request(request.method, params);
      else {if (languageContext?.javaAbiCurrent() === false) {void languageContext.awaitJavaAbi().catch(() => {}); throw Error("android-indexing");} result = await backend.request(request.method, params);}
      if (["textDocument/definition", "textDocument/references"].includes(request.method)) result = await canonical(result, {bytes: 0}, params.textDocument.uri);
    }
    if (doc.version !== version || current !== revision) throw Error("stale-result");
    host.reply(request.id, result);
  } catch(error) {const code=errorCode(error);trace(code);const transient=error?.code===-32801||["android-indexing","stale-result","stale-diagnostics","kotlin-session-busy","working-copy-not-current"].includes(code);host.reject(request.id, transient?-32801:-32603, transient?"Language analysis is indexing or its source context has changed.":code);}
  finally {active--;}
});
host.on("notification", notification => {
  const {method, params} = notification;
  if(method==="asterlyn/setDebugTracing"){debugTracing=params?.enabled===true;return;}
  if (method === "initialized") {status(false); void load(); poll = setInterval(() => void load(), 5000); poll.unref();}
  else if (method === "asterlyn/modelInvalidated") {indexing = true; revision++; modelGeneration = null; retryAt = 0; status(false); void load();}
  else if (method === "textDocument/didOpen") {const doc = params.textDocument; if (documents.size >= 32 && !documents.has(doc.uri)) return; documents.set(doc.uri, {languageId: doc.languageId, version: doc.version, text: doc.text}); revision++; if (backendReady) {if (doc.languageId === "java") backend.notify(method, params); void queueOverlay(doc.uri, doc);} }
  else if (method === "textDocument/didChange") {try {update(params); revision++; if (backendReady) {if (document(params.textDocument.uri).languageId === "java") backend.notify(method, params); void queueOverlay(params.textDocument.uri, document(params.textDocument.uri)); refreshDiagnostics();}} catch {}}
  else if (method === "textDocument/didClose") {const doc = documents.get(params.textDocument.uri); documents.delete(params.textDocument.uri); revision++; if (backendReady) {if (doc?.languageId === "java") backend.notify(method, params); void queueOverlay(params.textDocument.uri, null, true); refreshDiagnostics();}}
  else if (method === "exit") {closed = true; clearInterval(poll); void stopBackend().finally(() => process.exit(0));}
});
host.on("fatal", () => {closed = true; clearInterval(poll); void stopBackend().finally(() => process.exit(1));});
host.on("closed", () => {closed = true; clearInterval(poll); void stopBackend();});
process.on("SIGTERM", () => {closed = true; clearInterval(poll); void stopBackend().finally(() => process.exit(0));});
