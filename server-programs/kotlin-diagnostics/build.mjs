import { copyFile, mkdir, mkdtemp, readdir, readFile, stat, lstat, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const [sourceArg, distributionArg, jdkArg, outputArg, manifestArg] = process.argv.slice(2);
if (!sourceArg || !distributionArg || !jdkArg || !outputArg || !manifestArg) throw new Error("usage: node build.mjs <fwcd-source> <distribution-root> <jdk-home> <output.jar> <distribution-manifest.json>");
const source = resolve(sourceArg), distribution = resolve(distributionArg), jdk = resolve(jdkArg), output = resolve(outputArg);
const BASE_COMMIT = "6d9e61b79d4631e75516def7ab7ff0d8b9310467";
const rootCandidates = [join(distribution, "server"), distribution, join(distribution, "content", "server")];
let root;
for (const candidate of rootCandidates) {
  try { await readdir(join(candidate, "lib")); root = candidate; break; } catch {}
}
if (!root) throw new Error("distribution root has no lib directory");
const lib = join(root, "lib");
const manifest = JSON.parse(await readFile(resolve(manifestArg), "utf8"));
if (manifest.schema !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 20000) throw new Error("distribution manifest invalid");
let previous = "";
const actualFiles = [];
const collectFiles = async (directory, relative = "") => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`distribution symlink is unsafe: ${entryRelative}`);
    if (entry.isDirectory()) await collectFiles(entryPath, entryRelative);
    else if (entry.isFile()) actualFiles.push(entryRelative);
    else throw new Error(`distribution entry is unsupported: ${entryRelative}`);
  }
};
await collectFiles(distribution);
actualFiles.sort();
if (actualFiles.length !== manifest.files.length || actualFiles.some((path, index) => path !== manifest.files[index]?.path)) throw new Error("distribution manifest does not cover the complete file set");
for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== "string" || entry.path.length === 0 || entry.path.startsWith("/") || entry.path.includes("..") || entry.path <= previous || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error("distribution manifest entry invalid");
  previous = entry.path;
  const file = resolve(distribution, entry.path);
  if (!file.startsWith(`${distribution}/`) || (await lstat(file)).isSymbolicLink()) throw new Error(`distribution file is unsafe: ${entry.path}`);
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size !== entry.bytes) throw new Error(`distribution file size mismatch: ${entry.path}`);
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  if (digest !== entry.sha256) throw new Error(`distribution file digest mismatch: ${entry.path}`);
}
const sourceCommit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (sourceCommit !== BASE_COMMIT) throw new Error(`unexpected fwcd source commit: ${sourceCommit}`);
const scratch = await mkdtemp(join(tmpdir(), "asterlyn-kotlin-build-"));
try {
execFileSync("git", ["-C", source, "archive", "--format=tar", BASE_COMMIT, "-o", join(scratch, "source.tar")]);
await mkdir(join(scratch, "source"));
execFileSync("tar", ["-xf", join(scratch, "source.tar"), "-C", join(scratch, "source")]);
execFileSync("patch", ["-p1", "-i", join(resolve(import.meta.dirname), "diagnostics-version.patch")], { cwd: join(scratch, "source") });
execFileSync("patch", ["-p1", "-i", join(resolve(import.meta.dirname), "uri-parsing.patch")], {cwd: join(scratch,"source")});
const classes = join(scratch, "classes");
await mkdir(classes);
const jars = (await readdir(lib)).filter((name) => name.endsWith(".jar")).sort().map((name) => join(lib, name));
const classpath = jars.join(delimiter);
const java = join(jdk, "bin", "java");
const compiler = ["-cp", classpath, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-classpath", classpath, "-d", classes,
  join(scratch, "source/server/src/main/kotlin/org/javacs/kt/SourceFiles.kt"),
  join(scratch, "source/server/src/main/kotlin/org/javacs/kt/KotlinTextDocumentService.kt"),
  join(scratch, "source/server/src/main/kotlin/org/javacs/kt/KotlinLanguageServer.kt"),
  join(scratch, "source/shared/src/main/kotlin/org/javacs/kt/util/URIs.kt")];
execFileSync(java, compiler, { stdio: "inherit" });
await mkdir(resolve(output, ".."), { recursive: true });
await copyFile(join(lib, "server-1.3.13.jar"), output);
const jar = join(jdk, "bin", "jar");
execFileSync(jar, ["--update", "--date=2020-01-01T00:00:00Z", "--file", output, "-C", classes, "org/javacs/kt"], { stdio: "inherit" });
const digest = createHash("sha256").update(await import("node:fs/promises").then(({ readFile }) => readFile(output))).digest("hex");
console.log(JSON.stringify({ sourceCommit, output, sha256: digest }));
} finally {await rm(scratch,{recursive:true,force:true});}
