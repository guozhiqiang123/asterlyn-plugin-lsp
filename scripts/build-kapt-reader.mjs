import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(new URL("..", import.meta.url).pathname);
const out = resolve(process.argv[2] ?? join(root, "server-programs", "kapt-metadata-reader.jar"));
const scratch = await mkdtemp(join(tmpdir(), "asterlyn-kapt-reader-"));
await cp(join(root, "server-programs", "kapt-metadata-reader.java"), join(scratch, "KaptMetadataReader.java"));
await mkdir(join(scratch, "classes"));
execFileSync("javac", ["--release", "17", "-d", join(scratch, "classes"), join(scratch, "KaptMetadataReader.java")], { stdio: "inherit" });
execFileSync("jar", ["--create", "--file", out, "--date=2020-01-01T00:00:00Z", "--main-class", "KaptMetadataReader", "-C", join(scratch, "classes"), "KaptMetadataReader.class"], { stdio: "inherit" });
console.log(JSON.stringify({ output: out }));
await rm(scratch, { recursive: true, force: true });
