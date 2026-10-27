import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);
const sourceExt = new Set([".kt", ".kts", ".java"]);
const asPath = (value) => value instanceof URL ? value.pathname : resolve(String(value));
const uri = (value) => pathToFileURL(resolve(value)).href;
const inside = (root, value) => value === root || value.startsWith(`${root}${sep}`);
const reader = new URL("./kapt-metadata-reader.java", import.meta.url);

async function sourceFiles(root, result = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) await sourceFiles(file, result);
    else if (entry.isFile() && sourceExt.has(extname(entry.name))) result.push(file);
  }
  return result;
}
async function allFiles(root, result = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) await allFiles(file, result);
    else if (entry.isFile()) result.push(file);
  }
  return result;
}
function positionAt(text, offset) {
  const bounded = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, bounded);
  const line = (before.match(/\n/g) ?? []).length;
  const start = before.lastIndexOf("\n") + 1;
  return { line, character: [...before.slice(start)].length };
}

/**
 * Generate Java source stubs using the public Kotlin KAPT compiler plugin.
 * The plugin emits `.kapt_metadata`; the host must consume that metadata to
 * translate JDT declaration ranges back to Kotlin. No annotation processor is
 * executed (aptMode=stubs).
 */
export async function generateKaptStubs({ model, stateDirectory, java, compilerJar, kaptJar, runtimeJars = [], overlays = {} }) {
  if (!model?.modules?.length || !compilerJar || !kaptJar) throw new Error("kapt-stub-configuration-invalid");
  const state = resolve(asPath(stateDirectory));
  const root = join(state, `kapt-stubs-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const overlayMap = overlays instanceof Map ? overlays : new Map(Object.entries(overlays));
  const perModuleRoots = [];
  const originMaps = new Map();
  const originTexts = new Map();
  const originPaths = new Map();
  const originLineMaps = new Map();
  for (let index = 0; index < model.modules.length; index++) {
    const module = model.modules[index];
    const moduleRoot = join(root, `module-${index}`);
    const sourcesRoot = join(moduleRoot, "sources");
    const stubsRoot = join(moduleRoot, "stubs");
    const classesRoot = join(moduleRoot, "classes");
    const generatedRoot = join(moduleRoot, "generated");
    await Promise.all([mkdir(sourcesRoot, { recursive: true }), mkdir(stubsRoot, { recursive: true }), mkdir(classesRoot, { recursive: true }), mkdir(generatedRoot, { recursive: true })]);
    const inputs = [];
    const javaRoots = [];
    for (const declared of module.sources ?? []) {
      const sourceRoot = resolve(declared);
      const files = await sourceFiles(sourceRoot);
      if (files.some((file) => extname(file) === ".java")) javaRoots.push(sourceRoot);
      for (const source of files) {
        if (inside(state, source)) continue;
        const target = join(sourcesRoot, relative(sourceRoot, source));
        await mkdir(join(target, ".."), { recursive: true });
        const text = overlayMap.get(uri(source))?.text ?? await readFile(source, "utf8");
        await writeFile(target, text);
        originTexts.set(target, text);
        originPaths.set(target, source);
        if (extname(target) === ".kt" || extname(target) === ".kts") inputs.push(target);
      }
    }
    const classpath = [...(module.bootClasspath ?? []), ...(module.compileClasspath ?? [])].filter((item) => typeof item === "string").map(resolve);
    // Compiler and KAPT must precede any distribution compiler JAR. The fwcd
    // server bundle contains a non-embeddable compiler copy; placing it first
    // makes the public KAPT registrar fail with AbstractMethodError.
    const runtime = runtimeJars.map(asPath).filter((jar) => !jar.includes("kotlin-scripting"));
    const cp = [asPath(compilerJar), asPath(kaptJar), ...runtime].join(delimiter);
    const javaExecutable = asPath(java).endsWith(`${sep}java`) ? asPath(java) : join(asPath(java), "bin", "java");
    const compileClasspath = classpath.length ? classpath.join(delimiter) : runtime.join(delimiter);
    const args = ["-cp", cp, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-Xuse-k2-kapt", `-Xplugin=${asPath(kaptJar)}`,
      "-P", "plugin:org.jetbrains.kotlin.kapt3:aptMode=stubs", "-P", `plugin:org.jetbrains.kotlin.kapt3:stubs=${stubsRoot}`,
      "-P", `plugin:org.jetbrains.kotlin.kapt3:classes=${classesRoot}`, "-P", `plugin:org.jetbrains.kotlin.kapt3:sources=${generatedRoot}`,
      "-P", "plugin:org.jetbrains.kotlin.kapt3:correctErrorTypes=true", "-P", `plugin:org.jetbrains.kotlin.kapt3:apclasspath=${asPath(kaptJar)}`,
      "-classpath", compileClasspath, "-d", classesRoot, ...javaRoots.map((rootPath) => `-Xjava-source-roots=${rootPath}`), ...inputs];
    await exec(javaExecutable, args, { maxBuffer: 32 * 1024 * 1024 });
    const metadata = await allFiles(stubsRoot).then((files) => files.filter((file) => file.endsWith(".kapt_metadata")));
    for (const file of metadata) {
      const parsed = JSON.parse((await exec(javaExecutable, [reader.pathname, file])).stdout);
      originMaps.set(file, parsed);
      const stubFile = file.replace(/\.kapt_metadata$/, ".java");
      const stubLines = (await readFile(stubFile, "utf8")).split("\n");
      const lineMap = new Map();
      for (let line = 0; line < stubLines.length; line++) {
        const match = stubLines[line].match(/\b(\w+)\s*\([^)]*\)/);
        if (!match) continue;
        const key = Object.keys(parsed.lines).find((candidate) => candidate.includes(`#${match[1]}(`));
        if (key) lineMap.set(line, parsed.lines[key]);
      }
      originLineMaps.set(file, lineMap);
    }
    perModuleRoots.push({ module: module.name ?? `module-${index}`, stubRoot: stubsRoot, classRoot: classesRoot, metadata });
  }
  return { root, perModuleRoots, metadata: originMaps, mapOrigin: (stubUri, range = {}) => {
    const stubPath = asPath(stubUri);
    const metadataFile = originMaps.has(stubPath.replace(/\.java$/, ".kapt_metadata"))
      ? stubPath.replace(/\.java$/, ".kapt_metadata")
      : [...originMaps.keys()].find((file) => stubPath.startsWith(file.slice(0, -".kapt_metadata".length)));
    const parsed = metadataFile && originMaps.get(metadataFile);
    if (!parsed) return null;
    const lineEntry = originLineMaps.get(metadataFile)?.get(Number(range.start?.line ?? 0));
    const entries = Object.values(parsed.lines).filter((entry) => entry && typeof entry.path === "string");
    const entry = lineEntry ?? entries[Math.max(0, Math.min(entries.length - 1, Number(range.start?.line ?? 0)))];
    if (!entry) return null;
    const sourcePath = originPaths.get(entry.path) ?? entry.path;
    const position = positionAt(originTexts.get(entry.path) ?? "", entry.line);
    return { uri: uri(sourcePath), range: { start: position, end: position } };
  } };
}

export default { generateKaptStubs };
