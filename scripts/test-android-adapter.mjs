// Opt-in real Android fixture acceptance. Never writes to the fixture or downloads dependencies.
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {readFile, mkdtemp, writeFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {RpcPeer} from "../server-programs/rpc.mjs";

const [packageRoot, demoModel, prodModel, optionsFile, evidenceFile] = process.argv.slice(2);
if (!evidenceFile) throw Error("usage: test-android-adapter.mjs <extracted-package> <demo-model> <prod-model> <verified-options.json> <evidence.json>");
const options = JSON.parse(await readFile(optionsFile));
const state = await mkdtemp(join(tmpdir(), "asterlyn Android 中文 "));
const summaries = {checks: {}, timing: {}, peakRssKiB: 0};
const ownedPids = new Set();
let modelPath = resolve(demoModel), generation = 1, readyCount = 0, stderrBytes = 0;
const model = JSON.parse(await readFile(modelPath));
const docs = new Map();
for (const file of ["app/src/main/java/com/example/fixture/JavaUse.java", "app/src/main/kotlin/com/example/fixture/MainActivity.kt", "common/src/main/kotlin/com/example/common/LibraryValue.kt", "common/src/main/java/com/example/common/JavaBridge.java"]) {
  const text = await readFile(join(model.buildRoot, file), "utf8");
  docs.set(file.split("/").at(-1), {uri: pathToFileURL(join(model.buildRoot, file)).href, text, version: 1, languageId: file.endsWith(".java") ? "java" : "kotlin"});
}
const began = Date.now(), child = spawn(process.execPath, [join(packageRoot, "server-programs/android-server.mjs")], {stdio: ["pipe", "pipe", "pipe"]});
const peer = new RpcPeer(child.stdout, child.stdin), statuses = [], diagnosticEvents = [];
child.stderr.on("data", bytes => {stderrBytes += bytes.length;});
peer.on("fatal", error => {summaries.protocolFailure = error.message;});
peer.on("notification", notification => {
  if (notification.method === "experimental/serverStatus") {statuses.push(notification.params); console.log(JSON.stringify({stage: "backend-status", ...notification.params})); if (notification.params.quiescent) readyCount++;}
  if (notification.method === "asterlyn/trace") statuses.push(notification.params);
  if (notification.method === "textDocument/publishDiagnostics") diagnosticEvents.push({uri: notification.params.uri, version: notification.params.version, count: notification.params.diagnostics.length});
});
peer.on("request", async request => {
  if (request.method === "asterlyn/workspaceModel") {
    const bytes = await readFile(modelPath);
    peer.reply(request.id, {path: modelPath, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytes: bytes.length, generation, schema: 1});
  } else if (request.method === "workspace/diagnostic/refresh") peer.reply(request.id, null);
  else peer.reject(request.id, -32601);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const position = (text, symbol, end = false) => {
  const found = text.indexOf(symbol); assert.notEqual(found, -1, `symbol ${symbol}`);
  const prefix = text.slice(0, found + (end ? symbol.length : 2));
  return {line: prefix.split("\n").length - 1, character: prefix.slice(prefix.lastIndexOf("\n") + 1).length};
};
const wait = async (condition, timeout = 150000) => {const until = Date.now() + timeout; while (!condition()) {if (Date.now() > until) throw Error("acceptance-timeout"); await pause(50);}};
const semantic = async (method, name, symbol, extra = {}) => {
  const doc = docs.get(name), started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {const result = await peer.request(`textDocument/${method}`, {textDocument: {uri: doc.uri}, position: position(doc.text, symbol, method === "completion"), ...extra}, 30000); summaries.timing[`${method}-${name}`] = Date.now() - started; return result;}
    catch (error) {if (attempt >= 8) throw error; await pause(250);}
  }
};
const first = value => Array.isArray(value) ? value[0] : value;
const change = (name, text) => {const doc = docs.get(name); doc.text = text; doc.version++; peer.notify("textDocument/didChange", {textDocument: {uri: doc.uri, version: doc.version}, contentChanges: [{text}]});};
// Measure only this adapter's descendant tree, without using/terminating unrelated JVMs.
const sampler = setInterval(() => {
  try {
    const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], {encoding: "utf8"}).trim().split("\n").map(row => row.trim().split(/\s+/u).map(Number));
    const owned = new Set([child.pid]); let changed;
    do {changed = false; for (const [pid, parent] of rows) if (owned.has(parent) && !owned.has(pid)) {owned.add(pid); changed = true;}} while (changed);
    for (const pid of owned) ownedPids.add(pid);
    summaries.peakRssKiB = Math.max(summaries.peakRssKiB, rows.filter(([pid]) => owned.has(pid)).reduce((sum, row) => sum + row[2], 0));
  } catch {}
}, 250); sampler.unref();
try {
  await peer.request("initialize", {rootUri: pathToFileURL(model.buildRoot).href, initializationOptions: {analysis: {...options, stateDirectory: state}}});
  peer.notify("initialized", {});
  for (const doc of docs.values()) peer.notify("textDocument/didOpen", {textDocument: doc});
  await wait(() => readyCount > 0); summaries.timing.readyMs = Date.now() - began;
  assert.match(first(await semantic("definition", "JavaUse.java", "greeting"))?.uri ?? "", /LibraryValue\.kt$/u);
  assert.match(first(await semantic("definition", "MainActivity.kt", "label(this)"))?.uri ?? "", /JavaBridge\.java$/u);
  summaries.checks.bidirectionalDefinition = true;
  assert.ok(await semantic("hover", "JavaUse.java", "greeting"));
  assert.ok(await semantic("hover", "MainActivity.kt", "label(this)")); summaries.checks.hover = true;
  const sdk = first(await semantic("definition", "JavaUse.java", "getPackageName"));
  assert.match(sdk?.uri ?? "", /^asterlyn-source:\/\//u); assert.ok(sdk.readonlySource?.text.includes("class Context"));
  summaries.checks.sdkReadonlySource = {bytes: Buffer.byteLength(sdk.readonlySource.text), digest: sdk.uri.split("/")[2]};
  change("LibraryValue.kt", docs.get("LibraryValue.kt").text.replace("object LibraryValue {", "object LibraryValue {\n    @JvmStatic fun newlyAdded(value: Int): String = value.toString()"));
  change("JavaUse.java", docs.get("JavaUse.java").text.replace("LibraryValue.greeting()", "LibraryValue.newlyAdded(7)"));
  const dirtyKotlinTarget = first(await semantic("definition", "JavaUse.java", "newlyAdded"));
  assert.match(dirtyKotlinTarget?.uri ?? "", /LibraryValue\.kt$/u); assert.equal(dirtyKotlinTarget.range.start.line, 3);
  summaries.checks.unsavedKotlinSignatureFromJava = true;
  change("JavaBridge.java", docs.get("JavaBridge.java").text.replace("public final class JavaBridge {", "public final class JavaBridge {\n    public static String freshlyAdded(Context context) { return context.getPackageName(); }"));
  change("MainActivity.kt", docs.get("MainActivity.kt").text.replace("JavaBridge.label(this)", "JavaBridge.freshlyAdded(this)"));
  assert.match(first(await semantic("definition", "MainActivity.kt", "freshlyAdded"))?.uri ?? "", /JavaBridge\.java$/u);
  summaries.checks.unsavedJavaSignatureFromKotlin = true;
  const javaCompletion = await semantic("completion", "JavaUse.java", "LibraryValue.");
  const kotlinCompletion = await semantic("completion", "MainActivity.kt", "JavaBridge.");
  assert.ok((javaCompletion?.items ?? javaCompletion)?.length); assert.ok((kotlinCompletion?.items ?? kotlinCompletion)?.length);
  summaries.checks.completion = true;
  change("LibraryValue.kt", `${docs.get("LibraryValue.kt").text}\nval brokenValue = ;\n`);
  const dirtyDoc = docs.get("LibraryValue.kt");
  const diagnostics = await peer.request("textDocument/diagnostic", {textDocument: {uri: dirtyDoc.uri}}, 30000);
  assert.ok(diagnostics.items.length); assert.ok(diagnosticEvents.some(event => event.uri === dirtyDoc.uri && event.version === dirtyDoc.version && event.count > 0));
  summaries.checks.currentVersionUnsavedDiagnostic = true;
  // Restore a compilable dirty buffer before model replacement. It is never saved to the fixture.
  change("LibraryValue.kt", dirtyDoc.text.replace(/\nval brokenValue = ;\n$/u, ""));
  const previous = readyCount; modelPath = resolve(prodModel); generation++;
  peer.notify("asterlyn/modelInvalidated", {}); await wait(() => readyCount > previous);
  assert.match(first(await semantic("definition", "JavaUse.java", "newlyAdded"))?.uri ?? "", /LibraryValue\.kt$/u);
  assert.match(first(await semantic("definition", "MainActivity.kt", "freshlyAdded"))?.uri ?? "", /JavaBridge\.java$/u);
  summaries.checks.modelGenerationPreservesUnsavedBuffers = true;
  const warm = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = performance.now();
    assert.match(first(await semantic("definition", "JavaUse.java", "newlyAdded"))?.uri ?? "", /LibraryValue\.kt$/u);
    assert.match(first(await semantic("definition", "MainActivity.kt", "freshlyAdded"))?.uri ?? "", /JavaBridge\.java$/u);
    warm.push(performance.now() - start);
  }
  warm.sort((a,b)=>a-b); summaries.timing.warmBidirectionalPairP50Ms = Math.round(warm[9]); summaries.timing.warmBidirectionalPairP95Ms = Math.round(warm[18]);
  const validKotlin = docs.get("LibraryValue.kt").text;
  change("LibraryValue.kt", validKotlin.replace("object LibraryValue {", "import com.example.fixture.JavaUse\n\nobject LibraryValue {\n    fun invalidDependency() = JavaUse.value(null)"));
  const reverse = first(await semantic("definition", "LibraryValue.kt", "JavaUse.value"));
  assert.ok(!reverse, "library module must not resolve an app-only dependency");
  const invalidDiagnostics = await peer.request("textDocument/diagnostic", {textDocument: {uri: docs.get("LibraryValue.kt").uri}}, 30000);
  assert.ok(invalidDiagnostics.items.length); summaries.checks.reverseModuleDependencyRejected = true;
  change("LibraryValue.kt", validKotlin);
} catch (error) {summaries.failure = error.stack; process.exitCode = 1;}
finally {
  const stop = Date.now(); clearInterval(sampler);
  try {await peer.request("shutdown", null, 15000); peer.notify("exit", null);} catch {}
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), pause(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await wait(() => [...ownedPids].every(pid => {
    try {const result = execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], {encoding:"utf8",stdio:["ignore","pipe","ignore"]}); return !result.trim() || result.trim().startsWith("Z");}
    catch(error) {return error.status === 1;}
  }), 5000).catch(error => {summaries.cleanupFailure = error.message; process.exitCode = 1;});
  peer.close(); summaries.timing.shutdownMs = Date.now() - stop; summaries.timing.totalMs = Date.now() - began;
  summaries.statuses = statuses; summaries.stderrBytes = stderrBytes;
  await writeFile(evidenceFile, `${JSON.stringify(summaries, null, 2)}\n`);
  await rm(state, {recursive: true, force: true}); console.log(JSON.stringify(summaries));
}
