import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import path from "node:path";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";

const root = path.resolve(import.meta.dirname, "..");

function launch() {
  const child = spawn(process.execPath, [path.join(root, "servers/typescript/server.mjs"), "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  const messages = [];
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator < 0) break;
      const match = /Content-Length: (\d+)/i.exec(buffer.subarray(0, separator).toString());
      if (!match) throw new Error("missing LSP Content-Length");
      const length = Number(match[1]);
      if (buffer.length < separator + 4 + length) break;
      messages.push(JSON.parse(buffer.subarray(separator + 4, separator + 4 + length)));
      buffer = buffer.subarray(separator + 4 + length);
    }
  });
  const send = (message) => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const request = (id, method, params) => send({ jsonrpc: "2.0", id, method, params });
  const waitFor = async (predicate, timeoutMs = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = messages.find(predicate);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for LSP message; saw ${messages.map((message) => message.method ?? message.id).join(", ")}`);
  };
  return { child, send, request, waitFor };
}

test("packaged server handles unsaved Unicode TS diagnostics and language features", async (t) => {
  const fixture=realpathSync(mkdtempSync(path.join(tmpdir(),"asterlyn-ts-lsp-"))),uri=pathToFileURL(path.join(fixture,"main.ts")).href;
  const server = launch();
  t.after(async()=>{server.child.stdin.end();if(server.child.exitCode===null){await Promise.race([once(server.child,"exit"),new Promise(resolve=>setTimeout(resolve,1000))]);if(server.child.exitCode===null)server.child.kill("SIGTERM");}rmSync(fixture,{recursive:true,force:true});});
  const tsserverPath = path.join(root, "servers/typescript/typescript/lib/tsserver.js");
  server.request(1, "initialize", {
    processId: null,
    rootUri: pathToFileURL(fixture).href,
    capabilities: { textDocument: { publishDiagnostics: {}, hover: { contentFormat: ["plaintext"] }, definition: {}, completion: {} } },
    initializationOptions: { tsserver: { path: tsserverPath } },
  });
  await server.waitFor((message) => message.id === 1);
  server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  server.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: {
    textDocument: { uri, languageId: "typescript", version: 1, text: "const π = 1;\r\nconst broken: string = 123;\r\nbroken;\r\n" },
  } });
  const diagnostics = await server.waitFor((message) => message.method === "textDocument/publishDiagnostics" && message.params.uri === uri && message.params.diagnostics.some(diagnostic=>diagnostic.code===2322));
  assert.ok(diagnostics.params.diagnostics.length > 0);
  server.request(2, "textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 7 } });
  const hover = await server.waitFor((message) => message.id === 2);
  assert.match(hover.result.contents.value, /const π/);
  server.request(3, "textDocument/definition", { textDocument: { uri }, position: { line: 2, character: 0 } });
  const definition = await server.waitFor((message) => message.id === 3);
  assert.ok(definition.result?.length > 0);
  server.request(4, "textDocument/completion", { textDocument: { uri }, position: { line: 2, character: 0 } });
  const completion = await server.waitFor((message) => message.id === 4);
  assert.ok(completion.result.items.length > 0);
  server.child.stdin.end();
  await Promise.race([once(server.child, "exit"), new Promise((_, reject) => setTimeout(() => reject(new Error("server did not exit after EOF")), 5000))]);
  assert.ok(server.child.exitCode === 0 || server.child.exitCode === 1, `unexpected EOF exit code ${server.child.exitCode}`);
});
