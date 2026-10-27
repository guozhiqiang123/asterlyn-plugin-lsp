import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const [jdk, jdt, output] = process.argv.slice(2);
if (!jdk || !jdt || !output) throw new Error("usage: build-java-bridge.mjs <verified-jdk25> <verified-jdtls> <output.jar>");
const scratch = await mkdtemp(join(tmpdir(), "asterlyn-java-bridge-"));
const run = (file, args) => { const result = spawnSync(file, args, {encoding: "utf8"}); if (result.status !== 0) throw new Error(`Java bridge build failed: ${result.stderr.slice(0, 4096)}`); };
try {
  await mkdir(join(scratch, "classes"));
  run(join(jdk, "bin", "javac"), ["-cp", join(jdt, "plugins", "*"), "-d", join(scratch, "classes"), join(root, "server-programs/java-bridge/src/dev/asterlyn/lsp/WorkingCopyDiagnostics.java"), join(root,"server-programs/java-bridge/src/dev/asterlyn/lsp/DeclarationKey.java")]);
  await copyFile(join(root, "server-programs/java-bridge/plugin.xml"), join(scratch, "classes/plugin.xml"));
  await mkdir(dirname(resolve(output)), {recursive: true});
  run(join(jdk, "bin", "jar"), ["--create", "--date=2020-01-01T00:00:00Z", "--file", resolve(output), "--manifest", join(root, "server-programs/java-bridge/MANIFEST.MF"), "-C", join(scratch, "classes"), "."]);
} finally { await rm(scratch, {recursive: true, force: true}); }
