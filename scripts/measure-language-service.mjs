import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const serverPath = path.join(root, "servers/typescript/server.mjs");
const tsserverPath = path.join(root, "servers/typescript/typescript/lib/tsserver.js");
const minimumNode = [22, 22, 2];
const actualNode = process.versions.node.split(".").map(Number);
if (compareVersions(actualNode, minimumNode) < 0) {
  throw new Error(`Node >= 22.22.2 is required; found ${process.versions.node}`);
}
if (process.platform !== "darwin") {
  throw new Error(`This measurement is only accepted on macOS; found ${process.platform}`);
}
if (!existsSync(serverPath) || !existsSync(tsserverPath)) throw new Error("packaged TypeScript server assets are missing");

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "asterlyn-lsp-measure-"));
const sessions = [];
try {
  sessions.push(await measureSession("typescript", "main.ts", "const π = 1;\r\nconst broken: string = 123;\r\nbroken;\r\n", {
    hover: { line: 0, character: 7 }, definition: { line: 2, character: 0 },
  }));
  sessions.push(await measureSession("javascript", "main.js", "const π = 1;\r\nconst value = π;\r\nvalue;\r\n", {
    hover: { line: 0, character: 7 }, definition: { line: 2, character: 0 },
  }));
  const packagePath = path.join(root, "release", "dev.asterlyn.lsp-0.1.0.asterlyn-plugin.tgz");
  const packageBytes = await readFile(packagePath);
  console.log(JSON.stringify({
    node: process.versions.node,
    platform: process.platform,
    package: { bytes: packageBytes.byteLength, sha256: createHash("sha256").update(packageBytes).digest("hex") },
    documentLimitBytes: 2 * 1024 * 1024,
    documentLimitCount: 32,
    sessions,
    cleanup: sessions.every((session) => session.remainingProcessGroupPids.length === 0),
    note: "RSS is an observed macOS process-group sample, not a hard process-tree memory cap.",
  }, null, 2));
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

async function measureSession(languageId, fileName, text, positions) {
  const uri = `file://${path.join(fixtureRoot, fileName)}`;
  const child = spawn(process.execPath, [serverPath, "--stdio"], {
    cwd: root,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const started = performance.now();
  let inputClosed = false;
  let buffer = Buffer.alloc(0);
  const messages = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator < 0) break;
      const header = buffer.subarray(0, separator).toString();
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) throw new Error(`missing Content-Length from ${languageId} server`);
      const length = Number(match[1]);
      if (buffer.length < separator + 4 + length) break;
      messages.push(JSON.parse(buffer.subarray(separator + 4, separator + 4 + length).toString("utf8")));
      buffer = buffer.subarray(separator + 4 + length);
    }
  });
  const send = (message) => {
    if (inputClosed) throw new Error("server stdin already closed");
    const body = JSON.stringify(message);
    const header = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`);
    child.stdin.write(Buffer.concat([header, Buffer.from(body)]));
  };
  const request = (id, method, params) => send({ jsonrpc: "2.0", id, method, params });
  const waitFor = async (predicate, timeoutMs = 20_000) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const result = messages.find(predicate);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for ${languageId} LSP response; stderr=${stderr}`);
  };
  try {
    request(1, "initialize", {
      processId: null, rootUri: `file://${fixtureRoot}`,
      capabilities: { textDocument: { publishDiagnostics: {}, hover: { contentFormat: ["plaintext"] }, definition: {}, completion: {} } },
      initializationOptions: {
        tsserver: {
          path: tsserverPath,
          useSyntaxServer: "never",
          plugins: [],
          disableAutomaticTypingAcquisition: true,
          maxTsServerMemory: 512,
        },
      },
    });
    await waitFor((message) => message.id === 1);
    const initializeMs = performance.now() - started;
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId, version: 1, text } } });
    const diagnostics = await waitFor((message) => message.method === "textDocument/publishDiagnostics");
    if (languageId === "typescript" && diagnostics.params.diagnostics.length === 0) throw new Error("TypeScript fixture did not produce its expected diagnostic");
    const features = {};
    for (const [name, method, position] of [
      ["hover", "textDocument/hover", positions.hover],
      ["definition", "textDocument/definition", positions.definition],
      ["completion", "textDocument/completion", positions.definition],
    ]) {
      const id = Object.keys(features).length + 2;
      const featureStarted = performance.now();
      request(id, method, { textDocument: { uri }, position });
      const response = await waitFor((message) => message.id === id);
      if (response.error) throw new Error(`${languageId} ${name} failed: ${response.error.message}`);
      if (response.result == null) throw new Error(`${languageId} ${name} returned no result`);
      if (name === "definition" && !Array.isArray(response.result)) throw new Error(`${languageId} definition was not an array`);
      if (name === "completion" && !(Array.isArray(response.result) || Array.isArray(response.result.items))) throw new Error(`${languageId} completion was not a list`);
      features[name] = {
        milliseconds: round(performance.now() - featureStarted),
        resultCount: Array.isArray(response.result)
          ? response.result.length
          : Array.isArray(response.result.items)
            ? response.result.items.length
            : response.result.contents
              ? 1
              : 0,
      };
    }
    const rss = sampleProcessGroup(child.pid);
    const cleanupStarted = performance.now();
    inputClosed = true;
    child.stdin.end();
    const exit = await waitForExit(child, 5_000);
    const cleanupResult = await cleanupProcessGroup(child.pid);
    return {
      languageId, initializeMilliseconds: round(initializeMs),
      diagnostics: diagnostics.params.diagnostics.length,
      features, rss, exit, cleanupMilliseconds: round(performance.now() - cleanupStarted),
      cleanupForced: cleanupResult.forced,
      remainingProcessGroupPids: cleanupResult.remainingProcessGroupPids,
    };
  } catch (error) {
    if (!inputClosed) { inputClosed = true; child.stdin.destroy(); }
    terminateGroup(child.pid);
    throw error;
  }
}

function sampleProcessGroup(pid) {
  const rows = processTable().filter((row) => row.pgid === pid);
  return { pids: rows.map((row) => row.pid), rssKiB: rows.reduce((sum, row) => sum + row.rss, 0), rows };
}

function processTable() {
  const result = requirePs();
  return result.split("\n").map((line) => line.trim().split(/\s+/).map(Number))
    .filter((fields) => fields.length === 4 && fields.every(Number.isFinite))
    .map(([pid, ppid, pgid, rss]) => ({ pid, ppid, pgid, rss }));
}

function requirePs() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,rss="], { encoding: "utf8" });
}

async function waitForProcessGroupExit(pgid, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const pids = processTable().filter((row) => row.pgid === pgid).map((row) => row.pid);
    if (pids.length === 0) return [];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return processTable().filter((row) => row.pgid === pgid).map((row) => row.pid);
}

function terminateGroup(pgid) {
  try { process.kill(-pgid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
}

async function cleanupProcessGroup(pgid) {
  let remaining = await waitForProcessGroupExit(pgid, 250);
  if (remaining.length === 0) return { forced: false, remainingProcessGroupPids: [] };
  terminateGroup(pgid);
  remaining = await waitForProcessGroupExit(pgid, 1_000);
  if (remaining.length === 0) return { forced: true, remainingProcessGroupPids: [] };
  try { process.kill(-pgid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  remaining = await waitForProcessGroupExit(pgid, 1_000);
  return { forced: true, remainingProcessGroupPids: remaining };
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { terminateGroup(child.pid); reject(new Error("server did not exit after EOF")); }, timeoutMs);
    child.once("exit", (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
  });
}

function compareVersions(left, right) {
  for (let index = 0; index < right.length; index += 1) {
    if ((left[index] ?? 0) !== right[index]) return (left[index] ?? 0) - right[index];
  }
  return 0;
}

function round(value) { return Math.round(value * 100) / 100; }
