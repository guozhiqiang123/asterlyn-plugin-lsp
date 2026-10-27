import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const run = promisify(execFile);
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([".kt", ".kts"]);
const pathOf = (value) => value instanceof URL ? value.pathname : resolve(String(value));
const uri = (value) => pathToFileURL(resolve(value)).href;
const isInside = (root, value) => value === root || value.startsWith(`${root}${sep}`);

async function filesUnder(root, out = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) await filesUnder(file, out);
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) out.push(file);
  }
  return out;
}

function packageName(text) {
  return text.match(/^\s*package\s+([\w.]+)/m)?.[1] ?? "";
}

function classNames(javap) {
  const names = [];
  for (const line of javap.split("\n")) {
    const match = line.match(/^(?:public |final |abstract |interface |enum |class |strictfp )*(?:class|interface|enum)\s+([\w$]+)/);
    if (match && !match[1].includes("$")) names.push(match[1]);
  }
  return names;
}

function javaStub(javap, qualifiedName) {
  const simple = qualifiedName.split(".").pop();
  const packagePart = qualifiedName.slice(0, -(simple.length + 1));
  const body = [];
  let inClass = false;
  for (const line of javap.split("\n")) {
    if (/^(public |final |abstract |strictfp )*(class|interface|enum)\s+/.test(line)) { inClass = true; continue; }
    if (!inClass || !line.startsWith("  public ")) continue;
    const declaration = line.trim().replace(/;$/, "");
    const method = declaration.match(/^public\s+(?:static\s+)?(?:final\s+)?(.+?)\s+(\w+)\((.*)\)$/);
    if (!method || method[2] === simple) continue;
    const returnType = method[1].replace(/\s+$/, "");
    const args = method[3] ? method[3].split(",").map((arg, index) => `${arg.trim()} arg${index}`).join(", ") : "";
    const fallback = returnType === "void" ? "" : returnType === "boolean" ? " return false;" : returnType === "char" ? " return 0;" : returnType.match(/^(byte|short|int|long|float|double)$/) ? " return 0;" : " return null;";
    const staticModifier = /\bstatic\b/.test(declaration) ? "static " : "";
    body.push(`  public ${staticModifier}${returnType} ${method[2]}(${args}) {${fallback} }`);
  }
  return { text: `${packagePart ? `package ${packagePart};\n\n` : ""}public class ${simple} {\n${body.join("\n")}\n}\n`, methodLines: new Map(body.map((line, index) => [line.match(/\s(\w+)\(/)?.[1], (packagePart ? 4 : 2) + index])) };
}

function sourceLineMap(javap, stub) {
  const lines = new Map();
  const methods = [...javap.matchAll(/^\s+public\s+.*?\s(\w+)\([^)]*\);\n(?:.|\n)*?LineNumberTable:\n\s+line\s+(\d+):/gm)];
  for (const match of methods) {
    const stubLine = stub.methodLines.get(match[1]);
    if (stubLine !== undefined) lines.set(stubLine, Number(match[2]) - 1);
  }
  return lines;
}

async function compileModule({ javaPath, compilerLib, sources, classpath, output }) {
  if (!sources.length) return;
  await mkdir(output, { recursive: true });
  const compiler = javaPath.endsWith(`${sep}java`) ? javaPath : join(javaPath, "bin", "java");
  const cp = (await readdir(compilerLib)).filter((name) => name.endsWith(".jar")).sort().map((name) => join(compilerLib, name)).join(delimiter);
  await run(compiler, ["-cp", cp, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-classpath", classpath || cp, "-jvm-target", "17", "-d", output, ...sources], { maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Compile Kotlin overlays into private Java-readable stubs. This deliberately
 * uses the public Kotlin compiler distribution; kapt is not required because
 * no annotation processors are executed. mapOrigin is based on compiler
 * SourceFile/LineNumberTable data, never a same-name text search.
 */
export async function generateKotlinStubs({ model, stateDirectory, java, component, overlays = {} }) {
  if (!model?.modules?.length) throw new Error("kotlin-stub-model-invalid");
  const state = resolve(pathOf(stateDirectory));
  const root = join(state, `kotlin-stubs-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const compilerLib = join(resolve(pathOf(component.distributionRoot ?? component.root ?? component)), "server", "lib");
  const overlayMap = overlays instanceof Map ? overlays : new Map(Object.entries(overlays));
  const perModuleRoots = [];
  const origins = new Map();
  const sourceOrigins = new Map();
  let total = 0;
  for (let index = 0; index < model.modules.length; index++) {
    const module = model.modules[index];
    const privateModule = join(root, `module-${index}`);
    const sourceRoot = join(privateModule, "sources");
    const classRoot = join(privateModule, "classes");
    const stubRoot = join(privateModule, "java");
    await mkdir(sourceRoot, { recursive: true });
    const sources = [];
    for (const declared of module.sources ?? []) {
      const files = await filesUnder(resolve(declared));
      for (const source of files) {
        if (isInside(state, source)) continue;
        const text = overlayMap.get(uri(source))?.text ?? await readFile(source, "utf8");
        total += Buffer.byteLength(text);
        if (total > MAX_SOURCE_BYTES) throw new Error("kotlin-stub-size-bound");
        const target = join(sourceRoot, relative(resolve(declared), source));
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, text);
        sourceOrigins.set(target, source);
        sources.push(target);
      }
    }
    const classpath = [...(module.bootClasspath ?? []), ...(module.compileClasspath ?? [])].filter((x) => typeof x === "string").map(resolve).join(delimiter);
    const javaValue = resolve(pathOf(java));
    await compileModule({ javaPath: javaValue, compilerLib, sources, classpath, output: classRoot });
    await mkdir(stubRoot, { recursive: true });
    const classes = [];
    const walk = async (directory) => { for (const entry of await readdir(directory, { withFileTypes: true })) { const file = join(directory, entry.name); if (entry.isDirectory()) await walk(file); else if (entry.name.endsWith(".class") && !entry.name.includes("$")) classes.push(file); } };
    await walk(classRoot);
    for (const file of classes) {
      const qualified = relative(classRoot, file).slice(0, -6).split(sep).join(".");
      const javap = (await run(join(java, "bin", "javap"), ["-c", "-l", "-public", "-classpath", classRoot, qualified])).stdout;
      const stub = join(stubRoot, `${qualified.replaceAll(".", "/")}.java`);
      await mkdir(join(stub, ".."), { recursive: true });
      const stubSource = javaStub(javap, qualified);
      await writeFile(stub, stubSource.text);
      let sourceFile = null;
      const expectedPackage = qualified.split(".").slice(0, -1).join(".");
      for (const candidate of sources) {
        if (packageName(await readFile(candidate, "utf8")) === expectedPackage) { sourceFile = candidate; break; }
      }
      if (sourceFile) origins.set(uri(stub), { uri: uri(sourceOrigins.get(sourceFile) ?? sourceFile), lines: sourceLineMap(javap, stubSource), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } });
    }
    perModuleRoots.push({ module: module.name ?? `module-${index}`, stubRoot, classRoot });
  }
  return { perModuleRoots, root, mapOrigin: (stubUri, range = null) => {
    const origin = origins.get(stubUri);
    if (!origin) return null;
    const line = range?.start?.line;
    const mapped = line === undefined ? origin.range.start.line : (origin.lines.get(line) ?? origin.range.start.line);
    return { uri: origin.uri, range: { start: { line: mapped, character: 0 }, end: { line: mapped, character: 0 } } };
  } };
}

export default { generateKotlinStubs };
