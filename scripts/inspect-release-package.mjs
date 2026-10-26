import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "tar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const summary = JSON.parse(await readFile(path.join(root, "release/release-summary.json"), "utf8"));
const assetPath = path.join(root, "release", summary.asset);
const names = [];
await t({ file: assetPath, onentry: (entry) => names.push(entry.path) });
const expected = ["LICENSE", "manifest.json", "runtime/plugin.js"];
if (names.length !== expected.length || expected.some((name) => !names.includes(name))) throw new Error(`unexpected package files: ${names.join(", ")}`);
process.stdout.write(`${JSON.stringify({ asset: summary.asset, files: names })}\n`);
