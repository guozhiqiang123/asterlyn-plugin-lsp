import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { c as createTar } from "tar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
if (manifest.schemaVersion !== 3 || manifest.version !== packageJson.version) throw new Error("schema-3 metadata version mismatch");
if (Object.keys(manifest.distribution?.integrity ?? {}).length !== 0) throw new Error("source manifest integrity must be empty");

const releaseRoot = path.join(root, "release");
const staging = path.join(releaseRoot, ".staging");
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(path.join(staging, "runtime"), { recursive: true });
await build({ entryPoints: [path.join(root, "src/plugin.ts")], outfile: path.join(staging, "runtime/plugin.js"), bundle: true, format: "esm", platform: "neutral", target: "es2022", legalComments: "none", sourcemap: false });
await writeFile(path.join(staging, "LICENSE"), await readFile(path.join(root, "LICENSE")));

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else await writeFile(to, await readFile(from));
  }
}
await copyTree(path.join(root, "servers"), path.join(staging, "servers"));

const integrity = {};
async function collectFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}
for (const relative of ["LICENSE", "runtime/plugin.js", ...await collectFiles(path.join(staging, "servers"), "servers")]) {
  integrity[relative] = `sha256:${createHash("sha256").update(await readFile(path.join(staging, relative))).digest("hex")}`;
}
const admittedManifest = structuredClone(manifest);
admittedManifest.distribution.integrity = integrity;
await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(admittedManifest, null, 2)}\n`);
const assetName = `${manifest.id}-${manifest.version}.asterlyn-plugin.tgz`;
const assetPath = path.join(releaseRoot, assetName);
await createTar({ cwd: staging, file: assetPath, gzip: true, portable: true, noMtime: true }, ["manifest.json", "LICENSE", "runtime/plugin.js", "servers"]);
const asset = await readFile(assetPath);
await writeFile(path.join(releaseRoot, "release-summary.json"), `${JSON.stringify({ asset: assetName, version: manifest.version, bytes: asset.byteLength, sha256: createHash("sha256").update(asset).digest("hex"), files: integrity }, null, 2)}\n`);
await rm(staging, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ asset: assetName, bytes: asset.byteLength })}\n`);
