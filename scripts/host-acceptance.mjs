import { createHash } from "node:crypto";
import { mkdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t, x } from "tar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const android=process.argv.includes("--android");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const asset = path.join(root, "release", `${manifest.id}-${manifest.version}.asterlyn-plugin.tgz`);
const host = process.env.ASTERLYN_HOST_CHECKOUT;
if (!host) throw new Error("Set ASTERLYN_HOST_CHECKOUT to run native inspector/helper acceptance");
if (!existsSync(asset)) throw new Error("Run npm run package:release first");
const hostVersion = process.env.ASTERLYN_HOST_VERSION ?? JSON.parse(await readFile(path.join(host,"package.json"),"utf8")).version;
const inspector = process.env.ASTERLYN_PLUGIN_INSPECTOR;
const inspectorArgs = [asset, manifest.distribution.repository, manifest.version, hostVersion];
const inspected = inspector
  ? spawnSync(inspector, inspectorArgs, { cwd: root, encoding: "utf8" })
  : spawnSync("cargo", ["run", "--quiet", "--locked", "--manifest-path", path.join(host, "Cargo.toml"), "-p", "asterlyn-plugin-package", "--bin", "asterlyn-plugin-inspect", "--", ...inspectorArgs], { cwd: root, encoding: "utf8" });
if (inspected.status !== 0) throw new Error(`native package inspector rejected the archive:\n${inspected.stderr ?? inspected.stdout}`);

const packageBytes = await readFile(asset);
const digest = `sha256:${createHash("sha256").update(packageBytes).digest("hex")}`;
const extractionParent = await mkdtemp(path.join(os.tmpdir(), "asterlyn-lsp-acceptance-"));
const pluginRoot = path.join(extractionParent, "plugin");
await mkdir(pluginRoot, { recursive: true });
await x({ file: asset, cwd: pluginRoot });
const helperPath = process.env.ASTERLYN_PLUGIN_HOST ?? path.join(host, "target/debug/asterlyn-plugin-host");
if (!process.env.ASTERLYN_PLUGIN_HOST || !existsSync(helperPath)) {
  const built = spawnSync("cargo", ["build", "--locked", "--manifest-path", path.join(host, "Cargo.toml"), "-p", "asterlyn-plugin-host", "--bin", "asterlyn-plugin-host"], { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (built.status !== 0) throw new Error("could not build the native plugin-host helper");
}
const child = spawn(helperPath, ["--plugin-root", pluginRoot, "--plugin-id", manifest.id, "--plugin-version", manifest.version, "--package-digest", digest, "--runtime-entry", manifest.distribution.runtime.entry], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
const input = child.stdin;
const output = child.stdout;
let buffered=Buffer.alloc(0);const iterator=output[Symbol.asyncIterator]();
const deadline=setTimeout(()=>child.kill("SIGKILL"),15000);child.once("exit",()=>clearTimeout(deadline));input.on("error",()=>{});
const readFrame=async()=>{
 for(;;){if(buffered.length>=4){const size=buffered.readUInt32BE(0);if(size>16*1024*1024)throw Error("helper frame exceeded protocol limit");if(buffered.length>=size+4){const result=JSON.parse(buffered.subarray(4,size+4));buffered=buffered.subarray(size+4);return result;}}
 const chunk=await iterator.next();if(chunk.done)throw Error("native helper ended before its expected protocol response");buffered=Buffer.concat([buffered,chunk.value]);}
};
const sendFrame = (message) => { const bytes = Buffer.from(JSON.stringify(message)); const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length); input.write(Buffer.concat([header, bytes])); };
const first = await readFrame();
if (first.message?.type !== "hello") throw new Error(`native helper did not handshake: ${JSON.stringify(first)}`);
sendFrame({ protocol: 1, sequence: 1, message: { type: "helloAck", data: { sessionId: "lsp-acceptance", capabilities: [], permissions: ["host.language-services.execute"] } } });
sendFrame({ protocol: 1, sequence: 2, message: { type: "activate", data: { sessionId: "lsp-acceptance", workspaceId: "workspace-lsp-acceptance", workspaceGeneration: 1, workspaceRoot: "/workspace/lsp", evidence: android?[{kind:"workspace-catalog",values:{platform:"posix",truncated:false,files:["gradlew","settings.gradle.kts","app/src/main/AndroidManifest.xml"]}}]:[], locale: "en-US", theme: "dark" } } });
const ready = await readFrame();
if (ready.message?.type !== "activationReady") throw new Error(`native helper activation failed: ${JSON.stringify(ready)}`);
const contribution = ready.message.data.contributions?.[0];
if (contribution?.kind !== "languageService" || contribution.payload?.id !== "typescript-javascript" || contribution.payload?.serverId !== "typescript") throw new Error(`unexpected language contribution: ${JSON.stringify(contribution)}`);
const rust = ready.message.data.contributions?.[1];
if (ready.message.data.contributions.length !== (android?3:2) || rust?.kind !== "languageService" || rust.payload?.serverId !== "rust-analyzer" || rust.payload?.extensions?.[0] !== ".rs") throw new Error("Rust descriptor projection failed");
if(android&&ready.message.data.contributions[2]?.payload?.serverId!=="android-jvm")throw Error("Android descriptor projection failed");
sendFrame({ protocol: 1, sequence: 3, message: { type: "shutdown", data: { reason: "windowClosed" } } });
const started = Date.now();
await new Promise((resolve, reject) => { child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`helper shutdown code=${code} signal=${signal}`))); setTimeout(() => reject(new Error("helper cleanup timed out")), 5000); });
const summary = JSON.parse(await readFile(path.join(root, "release/release-summary.json"), "utf8"));
const resources = [];
await t({ file: asset, onentry: (entry) => { if (entry.type === "File") resources.push({ path: entry.path, bytes: entry.size }); } });
resources.sort((a, b) => b.bytes - a.bytes);
console.log(JSON.stringify({ android, hostVersion, pluginId: manifest.id, packageBytes: packageBytes.byteLength, uncompressedBytes: resources.reduce((sum, resource) => sum + resource.bytes, 0), integrityEntries: Object.keys(summary.files).length, largestResource: resources[0] ?? null, helperShutdownMs: Date.now() - started, packageSha256: summary.sha256, nativeInspector: true, isolatedActivation: true }, null, 2));
await rm(extractionParent, { recursive: true, force: true });
