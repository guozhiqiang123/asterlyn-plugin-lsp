import { copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const [sourceArg, distributionArg, jdkArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !distributionArg || !jdkArg || !outputArg) throw new Error("usage: node build.mjs <fwcd-source> <distribution-root> <jdk-home> <output.jar>");
const source = resolve(sourceArg), distribution = resolve(distributionArg), jdk = resolve(jdkArg), output = resolve(outputArg);
const BASE_COMMIT = "6d9e61b79d4631e75516def7ab7ff0d8b9310467";
const rootCandidates = [join(distribution, "server"), distribution, join(distribution, "content", "server")];
let root;
for (const candidate of rootCandidates) {
  try { readdir(join(candidate, "lib")); root = candidate; break; } catch {}
}
if (!root) throw new Error("distribution root has no lib directory");
const lib = join(root, "lib");
const sourceCommit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (sourceCommit !== BASE_COMMIT) throw new Error(`unexpected fwcd source commit: ${sourceCommit}`);
const scratch = await mkdtemp(join(tmpdir(), "asterlyn-kotlin-build-"));
execFileSync("git", ["-C", source, "archive", "--format=tar", BASE_COMMIT, "-o", join(scratch, "source.tar")]);
await mkdir(join(scratch, "source"));
execFileSync("tar", ["-xf", join(scratch, "source.tar"), "-C", join(scratch, "source")]);
execFileSync("patch", ["-p1", "-i", join(resolve(import.meta.dirname), "diagnostics-version.patch")], { cwd: join(scratch, "source") });
const classes = join(scratch, "classes");
await mkdir(classes);
const jars = (await readdir(lib)).filter((name) => name.endsWith(".jar")).map((name) => join(lib, name));
const classpath = jars.join(delimiter);
const java = join(jdk, "bin", "java");
const compiler = ["-cp", classpath, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-classpath", classpath, "-d", classes,
  join(scratch, "source/server/src/main/kotlin/org/javacs/kt/SourceFiles.kt"),
  join(scratch, "source/server/src/main/kotlin/org/javacs/kt/KotlinTextDocumentService.kt")];
execFileSync(java, compiler, { stdio: "inherit" });
await mkdir(resolve(output, ".."), { recursive: true });
await copyFile(join(lib, "server-1.3.13.jar"), output);
const jar = join(jdk, "bin", "jar");
execFileSync(jar, ["--update", "--date=2020-01-01T00:00:00Z", "--file", output, "-C", classes, "org/javacs/kt"], { stdio: "inherit" });
const digest = createHash("sha256").update(await import("node:fs/promises").then(({ readFile }) => readFile(output))).digest("hex");
console.log(JSON.stringify({ sourceCommit, output, sha256: digest }));
