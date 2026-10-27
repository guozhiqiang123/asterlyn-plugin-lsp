// Development-only direct JDT bridge regression.  It never writes the input model
// or business sources; the only source change is an in-memory didOpen overlay.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {spawn} from "node:child_process";
import {RpcPeer} from "../rpc.mjs";
import {createJavaModel, prepareJdt} from "../java-model.mjs";

const [modelPath, jdtRoot, javaHome] = process.argv.slice(2);
if (!modelPath || !jdtRoot || !javaHome) throw Error("usage: node server-programs/java-bridge/test-syntax-only.mjs <model.json> <jdtls-root> <jdk-25-home>");
const model = JSON.parse(await readFile(modelPath, "utf8"));
const state = await mkdtemp(join(tmpdir(), "asterlyn-java-bridge-test-"));
const bridge = fileURLToPath(new URL("../java-bridge.jar", import.meta.url));
let child;
try {
  const view = await createJavaModel(model, state);
  const launch = await prepareJdt(jdtRoot, state);
  child = spawn(join(javaHome, "bin/java"), ["-Xmx1G", "-Declipse.application=org.eclipse.jdt.ls.core.id1", "-Dosgi.bundles.defaultStartLevel=4", "-Declipse.product=org.eclipse.jdt.ls.core.product", "--add-modules=ALL-SYSTEM", "--add-opens", "java.base/java.util=ALL-UNNAMED", "--add-opens", "java.base/java.lang=ALL-UNNAMED", "-jar", launch.launcher, "-configuration", launch.configuration, "-data", launch.data], {cwd: state, env: {...process.env, JAVA_HOME: javaHome, PATH: join(javaHome, "bin")}, stdio: ["pipe", "pipe", "pipe"]});
  const peer = new RpcPeer(child.stdout, child.stdin);
  peer.on("request", request => {
    if (request.method === "workspace/configuration") peer.reply(request.id, (request.params?.items ?? []).map(() => ({java: {autobuild: {enabled: false}, import: {gradle: {enabled: false}, maven: {enabled: false}}}})));
    else if (["window/workDoneProgress/create", "window/showMessageRequest", "workspace/diagnostic/refresh", "client/registerCapability", "client/unregisterCapability"].includes(request.method)) peer.reply(request.id, null);
    else peer.reject(request.id, -32601);
  });
  const rootUri = pathToFileURL(view.root).href;
  await peer.request("initialize", {processId: process.pid, rootUri, workspaceFolders: [{uri: rootUri, name: "bridge-test"}], capabilities: {general: {positionEncodings: ["utf-16"]}, workspace: {configuration: true, workspaceFolders: true, applyEdit: false}, textDocument: {publishDiagnostics: {versionSupport: true}}}, initializationOptions: {bundles: [bridge], workspaceFolders: [rootUri], settings: {java: {autobuild: {enabled: false}, import: {gradle: {enabled: false}, maven: {enabled: false}}}}}}, 60000);
  peer.notify("initialized", {});
  await new Promise(resolve => setTimeout(resolve, 7000));
  const module = model.modules.find(item => item.module === ":app") ?? model.modules[0];
  const sourceRoot = module.sources.find(item => item.endsWith("/java"));
  if (!sourceRoot) throw Error("fixture-has-no-java-source");
  const uri = pathToFileURL(join(sourceRoot, "com/example/fixture/JavaUse.java")).href;
  const baseline = "package com.example.fixture;\nclass SyntaxProbe { String value = \"ok\"; }\n";
  const digestOf = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
  peer.notify("textDocument/didOpen", {textDocument: {uri, languageId: "java", version: 7, text: baseline}});
  await new Promise(resolve => setTimeout(resolve, 1000));
  const call = (text, version, syntaxOnly) => peer.request("workspace/executeCommand", {command: "asterlyn.java.documentDiagnostics", arguments: [{uri, version, digest: digestOf(text), syntaxOnly}]}, 30000);
  const baselineResult = await call(baseline, 7, true);
  assert.equal(baselineResult.version, 7); assert.equal(baselineResult.digest, digestOf(baseline));
  assert.equal(baselineResult.items.length, 0, "valid baseline unexpectedly reported syntax errors");
  const text = [
    "package com.example.fixture;", "class SyntaxProbe {", "  String value = \"ok\";", "  int first = 1;",
    "  int second = first + 1;", "  String third = value;", "  int fourth = 4;", "  int fifth = 5;",
    "  int sixth = 6;", "  int seventh = 7;", "  int eighth = 8;", "  int ninth = 9;",
    "  int tenth = 10;", "  int eleventh = 11;", "  int twelfth = 12;", "  int thirteenth = 13;",
    "  int fourteenth = 14;", "  int fifteenth = 15;", "  int sixteenth = 16;", "  int seventeenth = 17;",
    "  String wrong = 1; void invalid( }", "}", "",
  ].join("\n");
  const version = 8;
  peer.notify("textDocument/didChange", {textDocument: {uri, version}, contentChanges: [{text}]});
  await new Promise(resolve => setTimeout(resolve, 500));
  const syntax = await call(text, version, true), full = await call(text, version, false);
  const digest = digestOf(text);
  assert.equal(syntax.version, version); assert.equal(syntax.digest, digest);
  assert.equal(full.version, version); assert.equal(full.digest, digest);
  const syntaxCodes = syntax.items.map(item => Number(item.code));
  const fullCodes = full.items.map(item => Number(item.code));
  assert.ok(syntaxCodes.length > 0, "syntaxOnly returned no parser diagnostic");
  assert.ok(syntax.items.some(item => item.range.start.line >= 20), `syntax diagnostic did not follow changed line: ${JSON.stringify(syntax.items)}`);
  assert.ok(fullCodes.includes(16777233), `full diagnostics missing TypeMismatch: ${fullCodes.join(",")}`);
  assert.ok(!syntaxCodes.includes(16777233), "syntaxOnly leaked TypeMismatch");
  assert.ok(fullCodes.length > syntaxCodes.length, "full diagnostics did not add semantic result");
  await assert.rejects(() => peer.request("workspace/executeCommand", {command: "asterlyn.java.documentDiagnostics", arguments: [{uri, version: 7, digest: `sha256:${"0".repeat(64)}`, syntaxOnly: true}]}, 30000), "wrong digest was accepted");
  console.log(JSON.stringify({status: "passed", syntaxCodes, fullCodes, version, digest}));
} finally {
  if (child && !child.killed) child.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 500));
  if (child && !child.killed) child.kill("SIGKILL");
  await rm(state, {recursive: true, force: true});
}
