import { cp, mkdir, readdir, rm, stat, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { startKotlin } from "./kotlin-backend.mjs";
import { generateKaptStubs } from "./kotlin-kapt-stubs.mjs";

const pathOf = (value) => value instanceof URL ? fileURLToPath(value) : typeof value === "string" && value.startsWith("file:") ? fileURLToPath(value) : resolve(String(value));
const uri = (value) => pathToFileURL(resolve(value)).href;
const inside = (root, value) => value === root || value.startsWith(`${root}${sep}`);
const hasKotlin = (documents) => [...(documents instanceof Map ? documents.keys() : Object.keys(documents ?? {}))].some((value) => /\.(kt|kts)$/.test(String(value)));

async function findJar(root, names) {
  for (const name of names) {
    const file = join(root, name);
    try { if ((await stat(file)).isFile()) return file; } catch {}
  }
  throw new Error(`kotlin-component-jar-missing:${names.join(",")}`);
}

export async function prepareAndroidKotlin({ model, stateDirectory, options, documents = new Map(), onDiagnostics, onChanged }) {
  const state = pathOf(stateDirectory);
  const sessionRoot = join(state, `android-kotlin-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(sessionRoot, { recursive: true });
  const abort = new AbortController();
  const compilerRoot = pathOf(options.components["kotlin-compiler-bridge"].root);
  const compilerJar = await findJar(compilerRoot, ["kotlin-compiler-embeddable-2.2.0.jar", "kotlin-compiler.jar"]);
  const kaptJar = await findJar(compilerRoot, ["kotlin-annotation-processing-embeddable-2.2.0.jar", "kotlin-annotation-processing.jar"]);
  const languageRoot = pathOf(options.components["kotlin-language-server"].root);
  const patchJar = fileURLToPath(new URL("./kotlin-patched-server.jar", import.meta.url));
  const java = pathOf(options.tools.kotlinJava.java);
  const runtimeJars = [];
  for (const entry of await readdir(join(languageRoot, "server", "lib"))) if (entry.endsWith(".jar")) runtimeJars.push(join(languageRoot, "server", "lib", entry));
  let latest = null;
  let kaptPromise = null;
  let kotlin = null;
  let timer = null;
  const stableRoots = new Map();
  let revision = 0, builtRevision = -1;
  const copyStable = async (generated) => {
    for (const result of generated.perModuleRoots) {
      const moduleHash = createHash("sha256").update(String(result.module)).digest("hex").slice(0, 12);
      const stable = join(sessionRoot, `module-${moduleHash}`, "stubs");
      await rm(stable, { recursive: true, force: true });
      await mkdir(stable, { recursive: true });
      for (const metadata of result.metadata) {
        const javaStub = metadata.replace(/\.kapt_metadata$/, ".java");
        const relative = javaStub.slice(result.stubRoot.length + 1);
        const target = join(stable, relative);
        await mkdir(join(target, ".."), { recursive: true });
        await cp(javaStub, target);
      }
      stableRoots.set(result.module, stable);
    }
    onChanged?.([...generated.perModuleRoots.flatMap((result) => result.metadata.map((metadata) => ({ uri: uri(join(stableRoots.get(result.module), metadata.slice(result.stubRoot.length + 1).replace(/\.kapt_metadata$/, ".java"))), type: 1 })))]);
  };
  const regenerate = async () => {
    const generated = await generateKaptStubs({ model, stateDirectory: sessionRoot, java, compilerJar, kaptJar, runtimeJars, overlays: documents, signal: abort.signal });
    await copyStable(generated);
    latest = generated;
    return generated;
  };
  const ensureAbi = async () => {
    if (builtRevision === revision && latest) return latest;
    if (!kaptPromise) {
      const target = revision;
      kaptPromise = regenerate().then((result) => { builtRevision = target; return result; }).finally(() => { kaptPromise = null; });
    }
    await kaptPromise;
    return builtRevision === revision ? latest : ensureAbi();
  };
  const startIfNeeded = async () => {
    await ensureAbi();
    if (!hasKotlin(documents) || kotlin) return;
    kotlin = await startKotlin({ model, stateDirectory: sessionRoot, java, component: { distributionRoot: languageRoot, patchJar }, overlays: documents, configuration: {} });
    kotlin.peer.on("notification", (message) => { if (message.method === "textDocument/publishDiagnostics") onDiagnostics?.(message.params); });
  };
  const applyOverlay = async (fileUri, document) => {
    const next = document ?? {};
    revision++;
    if (documents instanceof Map) documents.set(fileUri, next); else documents[fileUri] = next;
    await ensureAbi();
    if (kotlin) await kotlin.applyOverlay(fileUri, next);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; ensureAbi().catch(onDiagnostics); }, 300);
  };
  const closeOverlay = async (fileUri) => {
    if (documents instanceof Map) documents.delete(fileUri); else delete documents[fileUri];
    revision++;
    if (kotlin) await kotlin.closeOverlay(fileUri);
    await ensureAbi();
  };
  const mapJavaDefinition = async (location, jdtPeer) => {
    const file = pathOf(location.uri);
    const stable = [...stableRoots.values()].find((root) => inside(root, file));
    if (!stable || !latest) return null;
    const response = await jdtPeer.request("workspace/executeCommand", { command: "asterlyn.java.declarationKey", arguments: [{ uri: location.uri, line: location.range?.start?.line ?? location.line, character: location.range?.start?.character ?? location.character }] });
    const key = response?.key;
    if (!key) return null;
    const module = [...stableRoots.entries()].find(([, root]) => inside(root, file))?.[0];
    const result = latest.perModuleRoots.find((entry) => entry.module === module);
    if (!result) return null;
    const generatedStub = join(result.stubRoot, file.slice(stable.length + 1));
    return latest.mapOriginByKey(uri(generatedStub), key);
  };
  const close = async () => {
    if (timer) clearTimeout(timer);
    abort.abort();
    await kotlin?.close();
    if (kaptPromise) await kaptPromise.catch(() => {});
    await rm(sessionRoot, { recursive: true, force: true });
  };
  return { extraSources: stableRoots, startIfNeeded, applyOverlay, closeOverlay, awaitJavaAbi: ensureAbi, request: async (method, params, timeout) => { await startIfNeeded(); return kotlin?.peer.request(method, params, timeout); }, mapJavaDefinition, close };
}

export default { prepareAndroidKotlin };
