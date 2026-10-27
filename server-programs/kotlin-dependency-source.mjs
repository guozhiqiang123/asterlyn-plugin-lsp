import {constants} from "node:fs";
import {lstat, open, realpath} from "node:fs/promises";
import {basename, extname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const MAX_BYTES = 512 * 1024;

/** Read only source previews created under this Kotlin session's private temporary root. */
export async function createOwnedSourceReader(directory) {
  const root = await realpath(directory);
  const inside = path => path.startsWith(`${root}${sep}`);
  const declared = resolve(directory);
  return async target => {
    if (typeof target !== "string" || !target.startsWith("file:")) return null;
    let path;
    try {path = resolve(fileURLToPath(target));} catch {return null;}
    if (!inside(path) && !path.startsWith(`${declared}${sep}`)) return null;
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw Error("dependency-source-not-admitted");
    const canonical = await realpath(path);
    if (!inside(canonical)) throw Error("dependency-source-not-admitted");
    const name = basename(canonical), extension = extname(name);
    if (!/^[\w$.-]{1,200}$/u.test(name) || ![".java", ".kt"].includes(extension)) throw Error("dependency-source-label");
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size > MAX_BYTES) throw Error("dependency-source-bound");
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      for (;;) {
        const {bytesRead} = await file.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
        if (length > MAX_BYTES) throw Error("dependency-source-bound");
      }
      const text = new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(0, length));
      return {text, path: name, languageId: extension === ".kt" ? "kotlin" : "java"};
    } finally {await file.close();}
  };
}
