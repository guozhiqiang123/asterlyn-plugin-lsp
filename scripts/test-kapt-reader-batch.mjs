import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const fixture = process.argv[2];
if (!fixture) throw new Error("usage: node test-kapt-reader-batch.mjs <kapt_metadata>");
const root = await mkdtemp(join(tmpdir(), "asterlyn-kapt-reader-batch-"));
const paths = [];
for (let i = 0; i < 1000; i++) {
  const file = join(root, `metadata ${i.toString().padStart(4, "0")} 中文🚀.kapt_metadata`);
  await cp(fixture, file);
  paths.push(file);
}
const manifest = join(root, "manifest with spaces 中文.txt");
await writeFile(manifest, `${paths.join("\n")}\n`, "utf8");
try {
  const started = Date.now();
  const { stdout } = await run("java", ["-Xmx128m", "-jar", fileURLToPath(new URL("../server-programs/kapt-metadata-reader.jar", import.meta.url)), manifest], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  const elapsedMs = Date.now() - started;
  const result = JSON.parse(stdout);
  const count = Object.keys(result.files ?? {}).length;
  if (count !== paths.length) throw new Error(`metadata count mismatch: ${count}`);
  console.log(JSON.stringify({ files: count, elapsedMs, unicodeAndSpaces: true, oneJvmInvocation: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
