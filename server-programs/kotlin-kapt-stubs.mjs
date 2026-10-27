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
        await writeFile(target, overlayMap.get(uri(source))?.text ?? await readFile(source, "utf8"));
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
    perModuleRoots.push({ module: module.name ?? `module-${index}`, stubRoot: stubsRoot, classRoot: classesRoot, metadata: await allFiles(stubsRoot).then((files) => files.filter((file) => file.endsWith(".kapt_metadata"))) });
  }
  return { root, perModuleRoots };
}

export default { generateKaptStubs };
