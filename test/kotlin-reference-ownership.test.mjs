import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {ownedKotlinReferences} from "../server-programs/kotlin-backend.mjs";

const range = {start: {line: 1, character: 2}, end: {line: 1, character: 5}};
const usage = uri => ({uri, range});
const owned = usage("file:///private/source-view/Class.kt");
const map = new Map([["/private/source-view/Class.kt", "/workspace/Class.kt"], ["/private/source-view/class.kt", "/workspace/Class.kt"]]);

test("compiler scratch references cannot discard valid imported class usages", () => {
  const entries = [usage("file:///dummy.kt"), owned, usage("file:///private/source-view/unmapped.kt")];
  assert.deepEqual(ownedKotlinReferences(entries, map), [owned]);
  assert.equal(entries.length, 3);
  assert.equal(ownedKotlinReferences(entries, map)[0], owned);
  assert.deepEqual(ownedKotlinReferences([usage("file:///dummy.kt")], map), []);
  assert.deepEqual(ownedKotlinReferences([], map), []);
  assert.equal(ownedKotlinReferences(null, map), null);
});

test("existing external files and other URI schemes do not grant reference ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asterlyn-reference-ownership-"));
  try {
    const file = join(directory, "Class.kt"); await writeFile(file, "class Class");
    assert.deepEqual(ownedKotlinReferences([usage(pathToFileURL(file).href), usage("kotlin://dependency/Class.kt"), owned], map), [owned]);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("reference ownership uses the same normalized paths and case aliases as source mapping", () => {
  const entries = [usage("file://localhost/private/source-view/class.kt"), usage("file:///private/source-view/folder/../Class.kt")];
  assert.deepEqual(ownedKotlinReferences(entries, map), entries);
  assert.deepEqual(ownedKotlinReferences([owned], new Map()), []);
});

test("malformed reference batches remain errors rather than successful empty lookups", () => {
  for (const value of [undefined, {}, owned, [null], [{}], [usage("relative.kt")], [usage("file:///bad%xx.kt")],
    [usage("file:///private/source-view/Class.kt?query")], [usage("file:///private/source-view/Class.kt#fragment")],
    [{...owned, range: {start: {line: -1, character: 0}, end: {line: 0, character: 0}}}],
    [{...owned, range: {start: {line: 1, character: 5}, end: {line: 1, character: 2}}}],
    [owned, {...owned, range: {start: {line: 0, character: 0}, end: {line: 2 ** 32, character: 0}}}]]) {
    assert.throws(() => ownedKotlinReferences(value, map), /kotlin-reference-result-invalid/u);
  }
});
