// Real project acceptance through the packaged stdio adapter; edits remain unsaved overlays.
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {readFile, writeFile, mkdtemp, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {RpcPeer} from "../server-programs/rpc.mjs";

const [packageRoot, modelFile, optionsFile, probesFile, evidenceFile] = process.argv.slice(2);
if (!evidenceFile) throw Error("usage: test-android-project.mjs <extracted-package> <model.json> <options.json> <probes.json> <evidence.json>");
const bytes = await readFile(modelFile), model = JSON.parse(bytes), options = JSON.parse(await readFile(optionsFile));
const probes = JSON.parse(await readFile(probesFile)), state = await mkdtemp(join(tmpdir(), "asterlyn-project-lsp-"));
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const docs = new Map();
for (const probe of probes) {
  if (docs.has(probe.path)) continue;
  const path = join(model.buildRoot, probe.path), text = await readFile(path, "utf8");
  docs.set(probe.path, {path, uri: pathToFileURL(path).href, text, version: 1, languageId: path.endsWith(".java") ? "java" : "kotlin", originalHash: hash(text)});
}
const child = spawn(process.execPath, [join(packageRoot, "server-programs/android-server.mjs")], {detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"]});
const peer = new RpcPeer(child.stdout, child.stdin), began = Date.now(), summary = {checks: [], statuses: [], peakRssKiB: 0}, diagnostics = [];
let ready = false, stderrBytes = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = new Promise(resolve => child.once("exit", resolve));
child.stderr.on("data", data => {stderrBytes += data.length;});
peer.on("fatal", error => {summary.protocolError = error.message;});
peer.on("notification", event => {
  if (event.method === "experimental/serverStatus") {
    summary.statuses.push({elapsedMs: Date.now() - began, ...event.params}); ready = event.params.quiescent;
    console.log(JSON.stringify({stage: "language-status", ...summary.statuses.at(-1)}));
  }
  if (event.method === "asterlyn/trace") summary.lastTrace = event.params;
  if (event.method === "textDocument/publishDiagnostics") diagnostics.push({uri: event.params.uri, version: event.params.version, count: event.params.diagnostics.length});
});
peer.on("request", event => {
  if (event.method === "asterlyn/workspaceModel") peer.reply(event.id, {path: resolve(modelFile), digest: hash(bytes), bytes: bytes.length, generation: 1, schema: 1});
  else if (event.method === "workspace/diagnostic/refresh") peer.reply(event.id, null);
  else peer.reject(event.id, -32601);
});
const sampler = setInterval(() => {
  try {
    const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], {encoding: "utf8"}).trim().split("\n").map(line => line.trim().split(/\s+/u).map(Number));
    const owned = new Set([child.pid]);
    for (let pass = 0; pass < 20; pass++) for (const [pid, parent] of rows) if (owned.has(parent)) owned.add(pid);
    summary.peakRssKiB = Math.max(summary.peakRssKiB, rows.filter(([pid]) => owned.has(pid)).reduce((total, row) => total + row[2], 0));
  } catch {}
}, 500); sampler.unref();
function position(doc, probe, completion = false) {
  const found = doc.text.indexOf(probe.symbol); assert.ok(found >= 0, "probe symbol is absent");
  const prefix = doc.text.slice(0, found + (completion ? probe.symbol.length : (probe.offset ?? 2)));
  return {line: prefix.split("\n").length - 1, character: prefix.slice(prefix.lastIndexOf("\n") + 1).length};
}
async function request(method, doc, probe, extra = {}) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {return await peer.request(`textDocument/${method}`, {textDocument: {uri: doc.uri}, ...(method === "diagnostic" ? {} : {position: position(doc, probe, method === "completion")}), ...extra}, 60000);}
    catch (error) {last = error; await pause(250);}
  }
  throw last;
}
try {
  await peer.request("initialize", {rootUri: pathToFileURL(model.buildRoot).href, initializationOptions: {analysis: {...options, stateDirectory: state}}});
  peer.notify("initialized", {});
  for (const doc of docs.values()) peer.notify("textDocument/didOpen", {textDocument: {uri: doc.uri, text: doc.text, version: doc.version, languageId: doc.languageId}});
  // Real multi-module imports are measured under the user's normal machine load. Individual
  // compiler jobs remain bounded; this acceptance budget must not be a hidden product SLA.
  const deadline = Date.now() + 600000;
  while (!ready) {if (Date.now() > deadline) throw Error("project-indexing-timeout"); await pause(100);}
  summary.readyMs = Date.now() - began;
  for (const probe of probes) {
    const doc = docs.get(probe.path), started = Date.now(), result = await request("definition", doc, probe);
    const targets = (Array.isArray(result) ? result : [result]).filter(Boolean);
    assert.ok(targets.some(target => (target.uri ?? target.targetUri)?.endsWith(probe.target)), `definition did not reach ${probe.target}`);
    assert.ok(await request("hover", doc, probe), "hover is empty");
    const completions = await request("completion", doc, {...probe, symbol: probe.completion});
    assert.ok((completions?.items ?? completions)?.length, "completion is empty");
    summary.checks.push({language: doc.languageId, definitionTarget: probe.target, hover: true, completion: true, durationMs: Date.now() - started});
    console.log(JSON.stringify({stage: "semantic-checked", ...summary.checks.at(-1)}));
    await writeFile(evidenceFile, `${JSON.stringify({...summary, inProgress: true}, null, 2)}\n`);
  }
  for (const language of ["java", "kotlin"]) {
    const doc = [...docs.values()].find(doc => doc.languageId === language), original = doc.text;
    const baseline = await request("diagnostic", doc, {});
    const injectedLine = original.split("\n").length, started = Date.now();
    doc.text += language === "java" ? "\nclass AsterlynUnsavedProbe { void invalid( }\n" : "\nval asterlynUnsavedProbe = ;\n";
    doc.version++;
    peer.notify("textDocument/didChange", {textDocument: {uri: doc.uri, version: doc.version}, contentChanges: [{text: doc.text}]});
    const result = await request("diagnostic", doc, {symbol: "Asterlyn"});
    assert.ok(result.items.length, "unsaved syntax diagnostics are empty");
    const injectedDiagnostics = result.items.filter(item => item.range?.end?.line >= injectedLine).length;
    assert.ok(injectedDiagnostics, "diagnostics do not cover the injected unsaved syntax error");
    summary.checks.push({language, baselineDiagnostics: baseline.items.length, dirtyDiagnostics: result.items.length, injectedDiagnostics, durationMs: Date.now() - started, version: doc.version, publishedCurrentVersion: diagnostics.some(item => item.uri === doc.uri && item.version === doc.version && item.count > 0)});
    console.log(JSON.stringify({stage: "dirty-diagnostics-checked", ...summary.checks.at(-1)}));
    doc.text = original; doc.version++;
    peer.notify("textDocument/didChange", {textDocument: {uri: doc.uri, version: doc.version}, contentChanges: [{text: original}]});
  }
  for (const doc of docs.values()) assert.equal(hash(await readFile(doc.path)), doc.originalHash, "source file changed on disk");
  summary.sourcesUnchanged = true;
} catch (error) {summary.failure = error.message; process.exitCode = 1;}
finally {
  clearInterval(sampler);
  const closing = Date.now();
  try {await peer.request("shutdown", null, 15000); peer.notify("exit", null);} catch {}
  await Promise.race([exited, pause(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-child.pid, "SIGTERM");
    await Promise.race([exited, pause(2000)]);
  }
  if (child.exitCode === null && child.signalCode === null) process.platform === "win32" ? child.kill("SIGKILL") : process.kill(-child.pid, "SIGKILL");
  peer.close(); await rm(state, {recursive: true, force: true});
  summary.shutdownMs = Date.now() - closing; summary.elapsedMs = Date.now() - began; summary.stderrBytes = stderrBytes;
  await writeFile(evidenceFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}
