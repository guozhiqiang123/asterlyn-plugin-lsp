import {cp, mkdir, readdir, rm, stat} from "node:fs/promises";
import {join, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {startKotlin} from "./kotlin-backend.mjs";
import {generateKaptStubs} from "./kotlin-kapt-stubs.mjs";

const pathOf = value => value instanceof URL ? fileURLToPath(value) : typeof value === "string" && value.startsWith("file:") ? fileURLToPath(value) : resolve(String(value));
const uri = value => pathToFileURL(resolve(value)).href;
const inside = (root, file) => file === root || file.startsWith(`${root}${sep}`);
const moduleHash = value => createHash("sha256").update(value).digest("hex").slice(0, 12);
async function findJar(root, name) {
  const file = join(root, name);
  if (!(await stat(file)).isFile()) throw Error("kotlin-component-jar-missing");
  return file;
}

/** One private source view per module dependency closure; at most two lazy Kotlin JVMs. */
export async function prepareAndroidKotlin({model, stateDirectory, options, documents = new Map(), onDiagnostics, onChanged, onBackendReady, onError = () => {}}) {
  const sessionRoot = join(pathOf(stateDirectory), `android-kotlin-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(sessionRoot, {recursive: true});
  const abort = new AbortController(), compilerRoot = pathOf(options.components["kotlin-compiler-bridge"].root);
  const compilerJar = await findJar(compilerRoot, "kotlin-compiler-embeddable-2.2.0.jar");
  const kaptJar = await findJar(compilerRoot, "kotlin-annotation-processing-embeddable-2.2.0.jar");
  const languageRoot = pathOf(options.components["kotlin-language-server"].root);
  const patchJar = fileURLToPath(new URL("./kotlin-patched-server.jar", import.meta.url));
  const java = pathOf(options.tools.kotlinJava.java), runtimeJars = [];
  for (const file of await readdir(join(languageRoot, "server/lib"))) if (file.endsWith(".jar")) runtimeJars.push(join(languageRoot, "server/lib", file));
  const byId = new Map(model.modules.map(module => [module.module, module]));
  const closure = id => {
    const seen = new Set(), result = [];
    const visit = id => {
      if (seen.has(id)) return;
      const module = byId.get(id); if (!module) throw Error("android-module-dependency-missing");
      seen.add(id); result.push(module);
      for (const dep of module.projectDependencies ?? []) visit(typeof dep === "string" ? dep : dep.module);
    };
    visit(id); return result;
  };
  const moduleFor = value => {
    const file = pathOf(value);
    const matches = model.modules.flatMap(module => [...module.sources, ...(module.generatedSources ?? [])].filter(root => inside(root, file)).map(root => ({id: module.module, length: root.length})));
    return matches.sort((a, b) => b.length - a.length)[0]?.id;
  };
  const includes = (id, value) => closure(id).some(module => [...module.sources, ...(module.generatedSources ?? [])].some(root => inside(root, pathOf(value))));
  const docEntries = () => documents instanceof Map ? [...documents.entries()] : Object.entries(documents);
  const docsFor = id => new Map(docEntries().filter(([key]) => includes(id, key)).map(([key, value]) => [key, {...value}]));
  let latest = null, kaptPromise = null, revision = 0, builtRevision = -1, debounce = null;
  const stableRoots = new Map(), entries = new Map();
  for (const id of byId.keys()) {
    const root = join(sessionRoot, `module-${moduleHash(id)}`, "stubs");
    await mkdir(root, {recursive: true}); stableRoots.set(id, root);
  }
  const copyStable = async generated => {
    for (const result of generated.perModuleRoots) {
      const root = stableRoots.get(result.module);
      await rm(root, {recursive: true, force: true}); await mkdir(root, {recursive: true});
      for (const metadata of result.metadata) {
        const stub = metadata.replace(/\.kapt_metadata$/u, ".java");
        const target = join(root, stub.slice(result.stubRoot.length + 1));
        await mkdir(join(target, ".."), {recursive: true}); await cp(stub, target);
      }
    }
    await onChanged?.(generated.perModuleRoots.flatMap(result => result.metadata.map(metadata => ({uri: uri(join(stableRoots.get(result.module), metadata.slice(result.stubRoot.length + 1).replace(/\.kapt_metadata$/u, ".java"))), type: 1}))));
  };
  const regenerate = async () => {
    const generated = await generateKaptStubs({model, stateDirectory: sessionRoot, java, compilerJar, kaptJar, runtimeJars, overlays: new Map(docEntries().map(([key, value]) => [key, {...value}])), signal: abort.signal});
    try {await copyStable(generated);} catch (error) {await rm(generated.root, {recursive: true, force: true}); throw error;}
    const previous = latest; latest = generated;
    if (previous) await rm(previous.root, {recursive: true, force: true});
    return generated;
  };
  const ensureAbi = async () => {
    if (abort.signal.aborted) throw Error("android-language-session-ended");
    if (builtRevision === revision && latest) return latest;
    if (!kaptPromise) {
      const target = revision;
      kaptPromise = regenerate().then(result => {builtRevision = target; return result;}).finally(() => {kaptPromise = null;});
    }
    await kaptPromise;
    return builtRevision === revision ? latest : ensureAbi();
  };
  const scheduleAbi = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {debounce = null; void ensureAbi().catch(error => {if (!abort.signal.aborted) onError(error);});}, 300);
  };
  const closeEntry = async entry => {
    entries.delete(entry.id);
    await entry.starting?.catch(() => {});
    await entry.service?.close();
  };
  // Reservation happens before any await, so concurrent requests cannot exceed the two-slot bound.
  const startModule = async id => {
    if (abort.signal.aborted) throw Error("android-language-session-ended");
    let entry = entries.get(id);
    if (entry?.closing) {await entry.starting; return startModule(id);}
    if (entry) {entry.lastUsed = Date.now(); return entry.starting ?? entry.service;}
    if (entries.size >= 2) {
      const victim = [...entries.values()].filter(entry => !entry.starting && !entry.refs).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!victim) throw Error("kotlin-session-busy");
      // Keep its slot reserved until shutdown has completed.
      victim.closing = true; victim.starting = victim.service.close().finally(() => entries.delete(victim.id));
      await victim.starting;
      return startModule(id);
    }
    entry = {id, refs: 0, lastUsed: Date.now(), service: null, starting: null}; entries.set(id, entry);
    entry.starting = (async () => {
      const initialDocs = docsFor(id);
      const onClosed = () => {
        if (!abort.signal.aborted && !entry.closing && entries.get(id) === entry) {
          entries.delete(id); void entry.service?.close(); onError(Error("kotlin-backend-exited"));
        }
      };
      const service = await startKotlin({model: {...model, modules: closure(id)}, stateDirectory: join(sessionRoot, `kotlin-${moduleHash(id)}`), java, component: {distributionRoot: languageRoot, patchJar}, overlays: initialDocs, configuration: {onError, onClosed}});
      entry.service = service;
      if (abort.signal.aborted) {await service.close(); throw Error("android-language-session-ended");}
      service.peer.on("notification", message => {
        if (!abort.signal.aborted && message.method === "textDocument/publishDiagnostics" && moduleFor(message.params.uri) === id) onDiagnostics?.(message.params);
      });
      for (const [key, value] of docsFor(id)) await service.applyOverlay(key, value);
      for (const key of initialDocs.keys()) if (!(documents instanceof Map ? documents.has(key) : key in documents)) await service.closeOverlay(key);
      if (!abort.signal.aborted) onBackendReady?.();
      return service;
    })().catch(async error => {entries.delete(id); await entry.service?.close(); throw error;}).finally(() => {entry.starting = null;});
    return entry.starting;
  };
  const startIfNeeded = async file => {
    const id = file ? moduleFor(file) : docEntries().filter(([key]) => /\.kt$/u.test(key)).map(([key]) => moduleFor(key)).find(Boolean);
    return id ? startModule(id) : null;
  };
  const applyOverlay = async (file, value) => {
    const previous = documents instanceof Map ? documents.get(file) : documents[file];
    if (previous?.version === value?.version && previous?.text === value?.text) return;
    if (documents instanceof Map) documents.set(file, {...value}); else documents[file] = {...value};
    revision++;
    for (const entry of entries.values()) if (entry.service && !entry.starting && includes(entry.id, file)) await entry.service.applyOverlay(file, value);
    scheduleAbi();
  };
  const closeOverlay = async file => {
    if (documents instanceof Map) documents.delete(file); else delete documents[file];
    revision++;
    for (const entry of entries.values()) if (entry.service && !entry.starting && includes(entry.id, file)) await entry.service.closeOverlay(file);
    scheduleAbi();
  };
  const refreshSources = async () => {
    let changes = 0;
    for (const entry of entries.values()) if (entry.service && !entry.starting) changes += (await entry.service.refreshSources()) ?? 0;
    if (changes) {revision++; scheduleAbi();}
    return changes;
  };
  const request = async (method, params, timeout) => {
    const service = await startIfNeeded(params.textDocument.uri); if (!service) return null;
    const entry = entries.get(moduleFor(params.textDocument.uri)); if (!entry || entry.service !== service) throw Error("kotlin-session-changed");
    entry.refs++; entry.lastUsed = Date.now();
    try {return await service.peer.request(method, params, timeout);} finally {entry.refs--; entry.lastUsed = Date.now();}
  };
  const mapJavaDefinition = async (location, jdtPeer) => {
    const file = pathOf(location.uri), stable = [...stableRoots.values()].find(root => inside(root, file));
    if (!stable || !latest) return null;
    const response = await jdtPeer.request("workspace/executeCommand", {command: "asterlyn.java.declarationKey", arguments: [{uri: location.uri, line: location.range?.start?.line ?? location.line, character: location.range?.start?.character ?? location.character}]});
    if (!response?.key) return null;
    const id = [...stableRoots].find(([, root]) => inside(root, file))?.[0];
    const result = latest.perModuleRoots.find(result => result.module === id);
    return result ? latest.mapOriginByKey(uri(join(result.stubRoot, file.slice(stable.length + 1))), response.key) : null;
  };
  const close = async () => {
    abort.abort(); clearTimeout(debounce);
    await Promise.all([...entries.values()].map(closeEntry));
    await kaptPromise?.catch(() => {}); await rm(sessionRoot, {recursive: true, force: true});
  };
  return {extraSources: stableRoots, startIfNeeded, ensureDocument: startIfNeeded, applyOverlay, closeOverlay, refreshSources, awaitJavaAbi: ensureAbi, request, mapJavaDefinition, close};
}
