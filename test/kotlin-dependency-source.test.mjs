import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {createOwnedSourceReader} from "../server-programs/kotlin-dependency-source.mjs";

test("Kotlin dependency previews read only regular source files owned by that session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asterlyn-kotlin-preview-"));
  try {
    const own = join(directory, "session"), other = join(directory, "other");
    await mkdir(own); await mkdir(other);
    const text = "// 中文 😀\nfun example() = 1\n";
    await writeFile(join(own, "Dependency.kt"), text);
    await writeFile(join(other, "Secret.java"), "class Secret {}\n");
    const read = await createOwnedSourceReader(own);
    assert.deepEqual(await read(pathToFileURL(join(own, "Dependency.kt")).href), {text, path: "Dependency.kt", languageId: "kotlin"});
    assert.equal(await read(pathToFileURL(join(other, "Secret.java")).href), null);
    assert.equal(await read("https://example.com/Dependency.kt"), null);
    await symlink(join(other, "Secret.java"), join(own, "Escaped.java"));
    await assert.rejects(read(pathToFileURL(join(own, "Escaped.java")).href), /dependency-source-not-admitted/u);
    await symlink(join(own, "Dependency.kt"), join(own, "Alias.kt"));
    await assert.rejects(read(pathToFileURL(join(own, "Alias.kt")).href));
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("Kotlin dependency previews reject oversized, invalid UTF-8 and non-source contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asterlyn-kotlin-preview-bound-"));
  try {
    const read = await createOwnedSourceReader(directory);
    await writeFile(join(directory, "Large.java"), Buffer.alloc(512 * 1024 + 1));
    await assert.rejects(read(pathToFileURL(join(directory, "Large.java")).href), /dependency-source-bound/u);
    await writeFile(join(directory, "Invalid.kt"), Buffer.from([0xff]));
    await assert.rejects(read(pathToFileURL(join(directory, "Invalid.kt")).href));
    await writeFile(join(directory, "Secrets.json"), "{}");
    await assert.rejects(read(pathToFileURL(join(directory, "Secrets.json")).href), /dependency-source-label/u);
  } finally {await rm(directory, {recursive: true, force: true});}
});
