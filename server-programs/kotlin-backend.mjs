import { cp, mkdir, readFile, readdir, stat, writeFile, lstat, realpath, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, extname, join, resolve, sep, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { RpcPeer } from "./rpc.mjs";
import { createOwnedSourceReader } from "./kotlin-dependency-source.mjs";

const MAX_SOURCE_FILES = 20000;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 100000;
const SOURCE_EXTENSIONS = new Set([".kt", ".kts", ".java"]);
const SERVER_JAR = "asterlyn-kotlin-server.jar";

const asPath = (value) => value instanceof URL ? fileURLToPath(value) : resolve(String(value));
const isInside = (root, value) => value === root || value.startsWith(`${root}${sep}`);
const uriPath = (value) => {
  if (typeof value !== "string" || !value.startsWith("file:")) return null;
  try { return resolve(fileURLToPath(value)); } catch { return null; }
};
const uriFor = (value) => pathToFileURL(value).href;
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

/** References are usages in imported sources, never compiler scratch PSI or dependency previews. */
export function ownedKotlinReferences(value, privateToOriginal) {
  if (value === null) return null;
  if (!Array.isArray(value)) throw Error("kotlin-reference-result-invalid");
  const point = p => p && Number.isSafeInteger(p.line) && Number.isSafeInteger(p.character)
    && p.line >= 0 && p.character >= 0 && p.line <= 0xffff_ffff && p.character <= 0xffff_ffff;
  return value.filter(location => {
    const start = location?.range?.start, end = location?.range?.end;
    if (typeof location?.uri !== "string" || location.uri.length > 16384
      || location.uri.trim() !== location.uri || /[\u0000-\u001f\u007f]/u.test(location.uri)
      || !point(start) || !point(end) || end.line < start.line
      || (end.line === start.line && end.character < start.character)) throw Error("kotlin-reference-result-invalid");
    let url;
    try {url = new URL(location.uri);} catch {throw Error("kotlin-reference-result-invalid");}
    if (url.protocol !== "file:") return false;
    const path = uriPath(location.uri);
    if (!path || url.search || url.hash) throw Error("kotlin-reference-result-invalid");
    // The compiler can include references from transient files such as dummy.kt.
    // File existence/name is not authority: only our captured source map admits a usage.
    return privateToOriginal.has(path) || privateToOriginal.has(path.toLowerCase());
  });
}

async function copySources(sourceRoot, destination, mappings, counter) {
  const info = await lstat(sourceRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("kotlin-source-root-invalid");
  const visit = async (source, target) => {
    if (++counter.entries > MAX_DIRECTORY_ENTRIES) throw new Error("kotlin-source-entry-bound");
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = join(target, entry.name);
      if (entry.isDirectory()) await visit(from, to);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        const metadata = await stat(from);
        if (metadata.size > MAX_SOURCE_FILE_BYTES || counter.files >= MAX_SOURCE_FILES || counter.bytes > MAX_SOURCE_BYTES - metadata.size) throw new Error("kotlin-source-size-bound");
        await cp(from, to);
        counter.files++;
        counter.bytes += metadata.size;
        const original = await realpath(from);
        const privatePath = resolve(to);
        mappings.originalToPrivate.set(original, privatePath);
        mappings.originalToPrivate.set(original.toLowerCase(), privatePath);
        mappings.privateToOriginal.set(privatePath, original);
        mappings.privateToOriginal.set(privatePath.toLowerCase(), original);
        mappings.fileStats.set(original, {size: metadata.size, mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs});
      }
    }
  };
  await visit(sourceRoot, destination);
}

function modelModules(model) {
  if (!model || model.schemaVersion !== 1 || !Array.isArray(model.modules) || model.modules.length === 0) throw new Error("kotlin-model-invalid");
  return model.modules.filter((module) => module && typeof module.directory === "string" && Array.isArray(module.sources));
}

async function componentLayout(component) {
  const supplied = asPath(component.distributionRoot ?? component.root ?? component);
  const candidates = [supplied, join(supplied, "server"), join(supplied, "content", "server")];
  for (const root of candidates) {
    const lib = join(root, "lib");
    try {
      await stat(join(lib, SERVER_JAR));
      return { root, lib };
    } catch {}
  }
  throw new Error("kotlin-component-layout-invalid");
}

async function createClasspathConfig(configRoot, classpath) {
  const directory = join(configRoot, "kotlin-language-server");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "classpath"), `#!/bin/sh\nprintf '%s' ${shellQuote(classpath.join(delimiter))}\n`, { mode: 0o700 });
}

function mapUriFactory(mappings, shadowRoot) {
  const convert = (value, reverse) => {
    const path = uriPath(value);
    if (!path) return value;
    const table = reverse ? mappings.privateToOriginal : mappings.originalToPrivate;
    const exact = table.get(path) ?? table.get(path.toLowerCase());
    return exact ? uriFor(exact) : value;
  };
  const mapObject = (value, reverse, key = "") => {
    if (typeof value === "string") return ["uri", "targetUri", "oldUri", "documentUri"].includes(key) ? convert(value, reverse) : value;
    if (Array.isArray(value)) return value.map((entry) => mapObject(entry, reverse, key));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => {
      const mappedName = reverse && uriPath(name) ? convert(name, true) : name;
      return [mappedName, mapObject(entry, reverse, name)];
    }));
  };
  return {
    input: (value) => mapObject(value, false),
    output: (value) => mapObject(value, true),
    privatePath: (path) => isInside(shadowRoot, path),
  };
}

export async function startKotlin({ model, stateDirectory, java, component, overlays = {}, configuration = {} }) {
  const state = resolve(asPath(stateDirectory));
  await mkdir(state, { recursive: true });
  const generation = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const shadowRoot = join(state, `kotlin-source-view-${generation}`);
  const configRoot = join(state, "kotlin-config");
  const temporaryRoot = join(state, `kotlin-temporary-${generation}`);
  await mkdir(temporaryRoot, {recursive: true});
  const privateTemporaryRoot = await realpath(temporaryRoot);
  const readDependencySource = await createOwnedSourceReader(privateTemporaryRoot);
  await mkdir(shadowRoot, { recursive: true });
  const mappings = { originalToPrivate: new Map(), privateToOriginal: new Map(), fileStats: new Map() };
  const sourceViews = [];
  for (const entry of await readdir(state, { withFileTypes: true })) {
    if (entry.name.startsWith("kotlin-source-view-") && entry.name !== `kotlin-source-view-${generation}`) await rm(join(state, entry.name), { recursive: true, force: true });
  }
  const counter = { entries: 0, files: 0, bytes: 0 };
  const modules = modelModules(model);
  const classpath = [];
  for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
    const module = modules[moduleIndex];
    const moduleRoot = join(shadowRoot, `module-${moduleIndex}`);
    const sourceRoots = [...new Set([...module.sources, ...(module.generatedSources ?? [])])];
    for (let sourceIndex = 0; sourceIndex < sourceRoots.length; sourceIndex++) {
      const sourceRoot = await realpath(resolve(sourceRoots[sourceIndex])).catch(() => resolve(sourceRoots[sourceIndex]));
      const privateRoot = join(moduleRoot, `source-${sourceIndex}`); sourceViews.push({sourceRoot, privateRoot});
      try { if ((await stat(sourceRoot)).isDirectory()) await copySources(sourceRoot, privateRoot, mappings, counter); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    for (const value of [...(module.bootClasspath ?? []), ...(module.compileClasspath ?? [])]) if (typeof value === "string") classpath.push(resolve(value));
  }
  const uniqueClasspath = [...new Set(classpath)];
  await createClasspathConfig(configRoot, uniqueClasspath);
  const layout = await componentLayout(component);
  // Seed the complete captured overlay set before compiler initialization. Otherwise opening a
  // Kotlin document starts lint while a later Java overlay replaces its compiler/classpath.
  const overlayEntries = overlays instanceof Map ? [...overlays.entries()] : Object.entries(overlays);
  for (const [original, overlay] of overlayEntries) {
    const source = uriPath(original) ?? resolve(original);
    const target = mappings.originalToPrivate.get(source) ?? mappings.originalToPrivate.get(source.toLowerCase());
    if (!target) continue;
    const text = String(overlay.text ?? "");
    if (Buffer.byteLength(text) > MAX_SOURCE_FILE_BYTES) throw Error("kotlin-overlay-size-bound");
    await writeFile(target, text);
  }
  const jars = (await readdir(layout.lib)).filter((name) => name.endsWith(".jar")).map((name) => join(layout.lib, name));
  const serverJar = join(layout.lib, SERVER_JAR);
  const runtimeClasspath = [serverJar, ...jars.filter((jar) => jar !== serverJar)].join(delimiter);
  const javaPath = asPath(java);
  configuration.onStart?.({ javaPath, runtimeClasspath: jars.length, lib: layout.lib });
  const env = { HOME: process.env.HOME ?? state, TMPDIR: process.env.TMPDIR ?? "/tmp", PATH: `${dirname(javaPath)}:/usr/bin:/bin`, JAVA_HOME: resolve(dirname(dirname(javaPath))), XDG_CONFIG_HOME: configRoot };
  // Keep the semantic server from exhausting its worker threads on large Android
  // models.  ExitOnOutOfMemoryError is intentional: a half-alive JVM cannot
  // answer LSP requests reliably and must be reclaimed by the owning session.
  const child = spawn(javaPath, ["-Xmx2048m", "-XX:+ExitOnOutOfMemoryError", `-Djava.io.tmpdir=${privateTemporaryRoot}`, "-cp", runtimeClasspath, "org.javacs.kt.MainKt"], { cwd: shadowRoot, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", (chunk) => configuration.onStderr?.(String(chunk).slice(0, 4096)));
  const upstream = new RpcPeer(child.stdout, child.stdin);
  const map = mapUriFactory(mappings, shadowRoot);
  let contextEpoch = 0;
  const mapNotification = (message) => {
    if (message?.method !== "textDocument/publishDiagnostics" || !message.params) return map.output(message.params);
    const privateUri = message.params.uri;
    const privatePath = uriPath(privateUri);
    const state = privatePath && openKotlin.get(privatePath);
    if (!state || message.params.version !== state.privateVersion) return null;
    const params = map.output({ ...message.params, version: state.hostVersion });
    return params;
  };
  const peer = {
    request: (method, params, timeout, signal) => upstream.request(method, map.input(params), timeout, signal)
      .then(result => map.output(["textDocument/references","kotlin/asterlynReferences"].includes(method) ? ownedKotlinReferences(result, mappings.privateToOriginal) : result)),
    notify: (method, params) => upstream.notify(method, map.input(params)),
    reply: (id, result) => upstream.reply(id, map.input(result)),
    reject: (...args) => upstream.reject(...args),
    on: (event, listener) => { upstream.on(event, (message) => { const params = mapNotification(message); if (message.method === "textDocument/publishDiagnostics" && params === null) return; listener({ ...message, params, result: map.output(message.result) }); }); return peer; },
    once: (event, listener) => { upstream.once(event, (message) => { const params = mapNotification(message); if (message.method === "textDocument/publishDiagnostics" && params === null) return; listener({ ...message, params, result: map.output(message.result) }); }); return peer; },
  };
  const onError = (error) => { if (configuration.onError) configuration.onError(error); };
  upstream.on("fatal", error => {onError(error); void close();}).on("closed", () => configuration.onClosed?.());
  child.on("error", onError);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    upstream.close();
    if (child.exitCode !== null) return;
    try { child.kill("SIGTERM"); } catch {}
    await new Promise((resolveClose) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolveClose();
      let settled = false;
      const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolveClose(); } };
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} finish(); }, 3000);
      child.once("exit", finish);
    });
  };
  const openKotlin = new Map();
  const privateVersions = new Map();
  const nextVersion = path => {const version = (privateVersions.get(path) ?? 0) + 1; privateVersions.set(path, version); return version;};
  const overlayState = new Map();
  // fwcd only treats Kotlin files as source roots. A Java shadow-file change
  // therefore needs a cheap Kotlin recompile kick so references observe the
  // new Java ABI without exposing Java documents to KLS.
  const kickKotlinRefresh = (except) => {
    contextEpoch++;
    for (const [privatePath, current] of openKotlin) {
      if (privatePath === except) continue;
      const version = nextVersion(privatePath);
      upstream.notify("textDocument/didChange", {
        textDocument: { uri: uriFor(privatePath), version },
        contentChanges: [{ text: current.text }],
      });
      openKotlin.set(privatePath, { ...current, privateVersion: version, contextEpoch });
    }
  };
  const mappedPrivatePath = async (uri) => {
    const value = uriPath(uri) ?? resolve(uri);
    const canonical = await realpath(value).catch(() => resolve(value));
    const existing = mappings.originalToPrivate.get(canonical) ?? mappings.originalToPrivate.get(canonical.toLowerCase());
    if (existing) return existing;
    const view = sourceViews.filter(view => isInside(view.sourceRoot, canonical)).sort((a,b)=>b.sourceRoot.length-a.sourceRoot.length)[0];
    if (!view || !SOURCE_EXTENSIONS.has(extname(canonical))) return;
    const metadata = await lstat(canonical);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_SOURCE_FILE_BYTES || ++counter.files > MAX_SOURCE_FILES || (counter.bytes += metadata.size) > MAX_SOURCE_BYTES) throw Error("kotlin-source-size-bound");
    const target = join(view.privateRoot, relative(view.sourceRoot, canonical));
    await mkdir(dirname(target), {recursive:true}); await cp(canonical,target);
    mappings.originalToPrivate.set(canonical,target); mappings.privateToOriginal.set(target,canonical);
    mappings.fileStats.set(canonical,{size:metadata.size,mtimeMs:metadata.mtimeMs});
    return target;
  };
  const applyOverlay = async (uri, overlay = {}) => {
    const privatePath = await mappedPrivatePath(uri);
    if (!privatePath) throw new Error("kotlin-overlay-outside-model");
    const text = String(overlay.text ?? "");
    if (Buffer.byteLength(text) > MAX_SOURCE_FILE_BYTES) throw new Error("kotlin-overlay-size-bound");
    const previousText = overlayState.get(privatePath) ?? await readFile(privatePath, "utf8");
    const unchanged = previousText === text;
    if (!unchanged) await writeFile(privatePath, text);
    overlayState.set(privatePath, text);
    if (extname(privatePath) === ".java") {
      // Opening/replaying a saved Java buffer is not a Java classpath change.
      if (unchanged) return;
      upstream.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: uriFor(privatePath), type: 2 }] });
      kickKotlinRefresh();
      return;
    }
    if (extname(privatePath) !== ".kt" && extname(privatePath) !== ".kts") return;
    const prior = openKotlin.get(privatePath);
    const hostVersion = Number(overlay.version ?? prior?.hostVersion ?? 0);
    if (prior?.text === text && prior.hostVersion === hostVersion) return;
    // Another Kotlin buffer can change this document's semantic diagnostics without changing
    // its own text. Invalidate outstanding reports while keeping compilation lazy.
    if (!unchanged) kickKotlinRefresh(privatePath);
    const privateVersion = nextVersion(privatePath);
    if (prior) upstream.notify("textDocument/didChange", { textDocument: { uri: uriFor(privatePath), version: privateVersion }, contentChanges: [{ text }] });
    else upstream.notify("textDocument/didOpen", { textDocument: { uri: uriFor(privatePath), languageId: "kotlin", version: privateVersion, text } });
    openKotlin.set(privatePath, { privateVersion, hostVersion, contextEpoch, text });
  };
  const closeOverlay = async (uri) => {
    const privatePath = await mappedPrivatePath(uri);
    const originalPath = privatePath && (mappings.privateToOriginal.get(privatePath) ?? mappings.privateToOriginal.get(privatePath.toLowerCase()));
    if (!privatePath || !originalPath) throw new Error("kotlin-overlay-source-missing");
    const text = await readFile(originalPath, "utf8");
    const changed = await readFile(privatePath, "utf8") !== text;
    if (changed) await writeFile(privatePath, text);
    overlayState.delete(privatePath);
    if (extname(privatePath) === ".java") {
      if (changed) {
        upstream.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: uriFor(privatePath), type: 2 }] });
        kickKotlinRefresh();
      }
    }
    else if (openKotlin.has(privatePath)) {
      // didClose restores the shadow file's disk text and releases open-file lint ownership.
      // Retain monotonic private versions across reopen so late reports cannot match a new owner.
      upstream.notify("textDocument/didClose", { textDocument: { uri: uriFor(privatePath) } });
      openKotlin.delete(privatePath);
      if (changed) kickKotlinRefresh();
    }
  };
  const refreshSources = async () => {
    const changes = [], affected = new Set();
    let inventoryEntries=0;
    const discover=async(root,depth=0)=>{
      if(depth>64||++inventoryEntries>MAX_DIRECTORY_ENTRIES)throw Error("kotlin-source-entry-bound");
      for(const entry of await readdir(root,{withFileTypes:true}).catch(error=>{if(error.code==="ENOENT")return [];throw error;})) {
        if(++inventoryEntries>MAX_DIRECTORY_ENTRIES)throw Error("kotlin-source-entry-bound");
        const file=join(root,entry.name);
        if(entry.isDirectory())await discover(file,depth+1);
        else if(entry.isFile()&&SOURCE_EXTENSIONS.has(extname(entry.name))&&!mappings.originalToPrivate.has(file)&&!mappings.originalToPrivate.has(file.toLowerCase())) {
          const target=await mappedPrivatePath(uriFor(file));if(target){changes.push({uri:uriFor(target),type:1});affected.add(uriFor(file));}
        }
      }
    };
    for(const root of new Set(sourceViews.map(view=>view.sourceRoot)))await discover(root);
    const seen = new Set();
    for (const [originalPath, privatePath] of mappings.originalToPrivate) {
      if (seen.has(privatePath) || overlayState.has(privatePath)) continue;
      seen.add(privatePath);
      const metadata = await lstat(originalPath).catch(() => null), previous = mappings.fileStats.get(originalPath);
      if (!metadata) {affected.add(uriFor(originalPath));await rm(privatePath,{force:true}); changes.push({uri:uriFor(privatePath),type:3}); mappings.fileStats.delete(originalPath); mappings.originalToPrivate.delete(originalPath); mappings.originalToPrivate.delete(originalPath.toLowerCase()); mappings.privateToOriginal.delete(privatePath); mappings.privateToOriginal.delete(privatePath.toLowerCase()); continue;}
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_SOURCE_FILE_BYTES) throw Error("kotlin-source-size-bound");
      if (previous?.size === metadata.size && previous.mtimeMs === metadata.mtimeMs && previous.ctimeMs === metadata.ctimeMs) continue;
      counter.bytes += metadata.size - (previous?.size ?? 0); if(counter.bytes > MAX_SOURCE_BYTES) throw Error("kotlin-source-size-bound");
      const text = await readFile(originalPath, "utf8");
      mappings.fileStats.set(originalPath,{size:metadata.size,mtimeMs:metadata.mtimeMs,ctimeMs:metadata.ctimeMs});
      // Saving an overlay can change mtime while leaving the already-current shadow unchanged.
      if (await readFile(privatePath, "utf8").catch(() => null) === text) continue;
      await writeFile(privatePath, text);
      affected.add(uriFor(originalPath));changes.push({uri:uriFor(privatePath),type:2});
    }
    if (changes.length) {
      upstream.notify("workspace/didChangeWatchedFiles", { changes });
      kickKotlinRefresh();
    }
    return {paths:[...affected]};
  };
  // didOpen can publish immediately. Subscribe/cache before initial overlays, rather than losing
  // the first versioned report while the caller is still awaiting creation of this session.
  peer.on("notification", message => {
    if (message.method === "textDocument/publishDiagnostics") configuration.onDiagnostics?.(message.params);
  });
  const documentDiagnostics = async original => {
    const privatePath = await mappedPrivatePath(original), current = openKotlin.get(privatePath);
    if (!current) throw Error("kotlin-document-not-open");
    const epoch = contextEpoch, digest = `sha256:${createHash("sha256").update(current.text).digest("hex")}`;
    const result = await upstream.request("kotlin/asterlynDocumentDiagnostics", {uri: uriFor(privatePath), version: current.privateVersion, digest});
    const latest = openKotlin.get(privatePath);
    if (latest !== current || contextEpoch !== epoch || result?.version !== current.privateVersion || result?.digest !== digest || !Array.isArray(result.items)) throw Error("stale-diagnostics");
    return {uri: uriFor(mappings.privateToOriginal.get(privatePath)), version: current.hostVersion, diagnostics: map.output(result.items)};
  };
  const rootUri = uriFor(shadowRoot);
  try { await upstream.request("initialize", {
    processId: null,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "Asterlyn Android model" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceFolders: true, applyEdit: false }, window: { workDoneProgress: true }, textDocument: { definition: { linkSupport: false }, hover: { contentFormat: ["plaintext", "markdown"] }, publishDiagnostics: { versionSupport: true } } },
    initializationOptions: { settings: configuration.settings ?? {}, workspaceFolders: [rootUri], bundles: [], extendedClientCapabilities: {} },
  }, 90000);
  upstream.notify("initialized", {});
  for (const [original, overlay] of overlayEntries) {
    await applyOverlay(original, overlay);
  }
  } catch (error) { await close(); throw error; }
  return { peer, close, applyOverlay, closeOverlay, documentDiagnostics, readDependencySource, refreshSources, distributionRoot: layout.root, privateRoot: shadowRoot, classpath: uniqueClasspath };
}

export default { startKotlin };
