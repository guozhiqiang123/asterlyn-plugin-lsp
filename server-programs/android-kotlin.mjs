import {moduleGraph} from "./android-module-graph.mjs";
import {cp, lstat, mkdir, readFile, readdir, rm, stat} from "node:fs/promises";
import {join, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {startKotlin} from "./kotlin-backend.mjs";
import {generateKaptStubs} from "./kotlin-kapt-stubs.mjs";

const pathOf = value => value instanceof URL ? fileURLToPath(value) : typeof value === "string" && value.startsWith("file:") ? fileURLToPath(value) : resolve(String(value));
const uri = value => pathToFileURL(resolve(value)).href;
const inside = (root, file) => file === root || file.startsWith(`${root}${sep}`);
const cancellable=(pending,signal)=>new Promise((resolve,reject)=>{
  const cancelled=()=>{signal?.removeEventListener("abort",cancelled);reject(Object.assign(Error("language-request-cancelled"),{code:-32800}));};
  if(signal?.aborted){cancelled();return;}signal?.addEventListener("abort",cancelled,{once:true});
  pending.then(resolve,reject).finally(()=>signal?.removeEventListener("abort",cancelled));
});
const moduleHash = value => createHash("sha256").update(value).digest("hex").slice(0, 12);
async function findJar(root, name) {
  const file = join(root, name);
  if (!(await stat(file)).isFile()) throw Error("kotlin-component-jar-missing");
  return file;
}

/** One private source view per module dependency closure; at most two lazy Kotlin JVMs. */
export async function prepareAndroidKotlin({model, stateDirectory, options, documents = new Map(), onDiagnostics, onChanged, onBackendReady, onJavaAbiReady = () => {}, onError = () => {}, onProgress = () => {}, trace = () => {}}) {
  const sessionRoot = join(pathOf(stateDirectory), `android-kotlin-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(sessionRoot, {recursive: true});
  const abort = new AbortController(), compilerRoot = pathOf(options.components["kotlin-compiler-bridge"].root);
  const compilerJar = await findJar(compilerRoot, "kotlin-compiler-embeddable-2.3.21.jar");
  const kaptJar = await findJar(compilerRoot, "kotlin-annotation-processing-embeddable-2.3.21.jar");
  const languageRoot = pathOf(options.components["kotlin-language-server-asterlyn"].root);
  const java = pathOf(options.tools.kotlinJava.java), runtimeJars = [];
  // The compiler bridge carries its own pinned runtime closure; do not mix server/compiler JARs.
  for (const file of await readdir(compilerRoot)) if (file.endsWith(".jar") && !file.startsWith("kotlin-compiler-embeddable-") && !file.startsWith("kotlin-annotation-processing-embeddable-")) runtimeJars.push(join(compilerRoot, file));
  const byId = new Map(model.modules.map(module => [module.module, module]));
  const graph=moduleGraph(model.modules),closure=id=>graph.closure(id);
  const moduleFor = value => {
    const file = pathOf(value);
    const matches = model.modules.flatMap(module => [...module.sources, ...(module.generatedSources ?? [])].filter(root => inside(root, file)).map(root => ({id: module.module, length: root.length})));
    return matches.sort((a, b) => b.length - a.length)[0]?.id;
  };
  const includes = (id, value) => closure(id).some(module => [...module.sources, ...(module.generatedSources ?? [])].some(root => inside(root, pathOf(value))));
  const docEntries = () => documents instanceof Map ? [...documents.entries()] : Object.entries(documents);
  const docsFor = id => new Map(docEntries().filter(([key]) => includes(id, key)).map(([key, value]) => [key, {...value}]));
  let latest = null, kaptPromise = null, revision = 0, builtRevision = -1, debounce = null, semanticPreparing=0,navigationPending=0;
  const javaAnchors=new Map();
  const stableRoots = new Map(), entries = new Map(), publishedKeys = new Map();
  const dirtyModules = new Set(byId.keys());
  const markDirty = file => {
    const owner = moduleFor(file);
    for (const id of byId.keys()) if (!owner || closure(id).some(module => module.module === owner)) dirtyModules.add(id);
  };
  for (const id of byId.keys()) {
    const root = join(sessionRoot, `module-${moduleHash(id)}`, "stubs");
    await mkdir(root, {recursive: true}); stableRoots.set(id, root);
  }
  const copyStable = async generated => {
    const changed = generated.perModuleRoots.filter(result => publishedKeys.get(result.module) !== result.key);
    for (const result of changed) {
      const root = stableRoots.get(result.module);
      await rm(root, {recursive: true, force: true}); await mkdir(root, {recursive: true});
      for (const metadata of result.metadata) {
        const stub = metadata.replace(/\.kapt_metadata$/u, ".java");
        const target = join(root, stub.slice(result.stubRoot.length + 1));
        await mkdir(join(target, ".."), {recursive: true}); await cp(stub, target);
      }
    }
    for (const result of changed) publishedKeys.set(result.module, result.key);
    if(changed.length)await onChanged?.(changed.flatMap(result => result.metadata.map(metadata => ({uri: uri(join(stableRoots.get(result.module), metadata.slice(result.stubRoot.length + 1).replace(/\.kapt_metadata$/u, ".java"))), type: 1}))));
  };
  const regenerate = async target => {
    const started=performance.now();trace("kotlin-abi-started",{backend:"compiler"});
    const generated = await generateKaptStubs({model, stateDirectory: sessionRoot, java, compilerJar, kaptJar, runtimeJars, overlays: new Map(docEntries().map(([key, value]) => [key, {...value}])), signal: abort.signal,onProgress,cacheDirectory:options.cacheDirectory,onCacheEvent:event=>{const {code,...details}=event;trace(code,details);},previous:latest,concurrency:2});
    trace("kotlin-abi-completed",{backend:"compiler",durationMs:Math.round(performance.now()-started),completed:generated.perModuleRoots.length});
    if (target !== revision) {await rm(generated.root,{recursive:true,force:true});return null;}
    try {await copyStable(generated);} catch (error) {await rm(generated.root, {recursive: true, force: true}); throw error;}
    if (target !== revision) {await rm(generated.root,{recursive:true,force:true});return null;}
    const previous = latest; latest = generated;
    if (previous) await rm(previous.root, {recursive: true, force: true});
    return generated;
  };
  const ensureAbi = async () => {
    if (abort.signal.aborted) throw Error("android-language-session-ended");
    if (builtRevision === revision && latest) return latest;
    if (!kaptPromise) {
      const target = revision;
      kaptPromise = regenerate(target).then(result => {if(result){builtRevision = target;if(builtRevision===revision){dirtyModules.clear();onJavaAbiReady();}}return result;}).finally(() => {kaptPromise = null;});
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
    const started=performance.now();onProgress({phase:"backend"});trace("kotlin-module-started",{backend:"kotlin",moduleHash:moduleHash(id)});
    entry.starting = (async () => {
      const initialDocs = docsFor(id);
      const onClosed = () => {
        if (!abort.signal.aborted && !entry.closing && entries.get(id) === entry) {
          entries.delete(id); void entry.service?.close(); onError(Error("kotlin-backend-exited"));
          trace("kotlin-module-exited",{backend:"kotlin",moduleHash:moduleHash(id)});
        }
      };
      const service = await startKotlin({model: {...model, modules: closure(id)}, stateDirectory: join(sessionRoot, `kotlin-${moduleHash(id)}`), java, component: {distributionRoot: languageRoot}, overlays: initialDocs, configuration: {onError, onClosed, onDiagnostics: params => {
        if (!abort.signal.aborted && moduleFor(params.uri) === id) onDiagnostics?.(params);
      }}});
      entry.service = service;
      if (abort.signal.aborted) {await service.close(); throw Error("android-language-session-ended");}
      for (const [key, value] of docsFor(id)) await service.applyOverlay(key, value);
      for (const key of initialDocs.keys()) if (!(documents instanceof Map ? documents.has(key) : key in documents)) await service.closeOverlay(key);
      trace("kotlin-module-ready",{backend:"kotlin",moduleHash:moduleHash(id),durationMs:Math.round(performance.now()-started)});
      return service;
    })().catch(async error => {entries.delete(id); await entry.service?.close(); throw error;}).finally(() => {entry.starting = null;if(entry.service&&!abort.signal.aborted)onBackendReady?.();});
    return entry.starting;
  };
  const startIfNeeded = async file => {
    const id = file ? moduleFor(file) : docEntries().filter(([key]) => /\.kt$/u.test(key)).map(([key]) => moduleFor(key)).find(Boolean);
    return id ? startModule(id) : null;
  };
  const warmProject = async () => {
    const opened=docEntries().find(([key])=>/\.kt$/u.test(key));
    const id=model.selection?.module??(opened?moduleFor(opened[0]):null);
    if(!id)return null;
    const hasKotlin=opened || latest?.perModuleRoots.some(result=>closure(id).some(module=>module.module===result.module)&&result.metadata.length);
    if(!hasKotlin)return null;
    semanticPreparing++;
    try {const service=await startModule(id),entry=entries.get(id);if(!entry||entry.service!==service)throw Error("kotlin-session-changed");
    const started=performance.now();entry.refs++;
    onProgress({phase:"indexing"});trace("kotlin-semantic-preparation-started",{backend:"kotlin",moduleHash:moduleHash(id)});
    try {await service.peer.request("kotlin/asterlynPrepare",{},120000,abort.signal);}
    finally {entry.refs--;entry.lastUsed=Date.now();trace("kotlin-semantic-preparation-completed",{backend:"kotlin",moduleHash:moduleHash(id),durationMs:Math.round(performance.now()-started)});}
    return service;
    }finally{semanticPreparing--;}
  };
  const readyFor = file => {const entry=entries.get(moduleFor(file));return !!entry?.service&&!entry.starting&&!entry.closing;};
  const applyOverlay = async (file, value) => {
    const previous = documents instanceof Map ? documents.get(file) : documents[file];
    if (previous?.version === value?.version && previous?.text === value?.text) return;
    // A newly opened saved buffer was already part of the imported source model. Register its
    // version/overlay ownership, but do not regenerate every module's ABI just for opening it.
    const matchesImportedInput = latest && builtRevision === revision && !kaptPromise
      && latest.sourceDigests.get(uri(pathOf(file))) === createHash("sha256").update(String(value?.text ?? "")).digest("hex");
    const changed = previous ? previous.text !== value?.text : !matchesImportedInput;
    if (documents instanceof Map) documents.set(file, {...value}); else documents[file] = {...value};
    if (changed) {revision++; markDirty(file);}
    for (const entry of entries.values()) if (entry.service && !entry.starting && includes(entry.id, file)) await entry.service.applyOverlay(file, value);
    if (changed) scheduleAbi();
  };
  const closeOverlay = async file => {
    const previous = documents instanceof Map ? documents.get(file) : documents[file];
    if (!previous) return;
    let changed = true;
    try {const path = pathOf(file), info = await lstat(path); if (info.isFile() && !info.isSymbolicLink() && info.size <= 2 * 1024 * 1024) changed = await readFile(path, "utf8") !== previous.text;} catch {}
    if (documents instanceof Map) documents.delete(file); else delete documents[file];
    if (changed) {revision++; markDirty(file);}
    for (const entry of entries.values()) if (entry.service && !entry.starting && includes(entry.id, file)) await entry.service.closeOverlay(file);
    if (changed) scheduleAbi();
    else await latest?.persistSaved?.();
  };
  const refreshSources = async () => {
    await latest?.persistSaved?.();
    let changes = 0;
    for (const entry of entries.values()) if (entry.service && !entry.starting) {
      const result = await entry.service.refreshSources();
      changes += result?.paths?.length ?? result ?? 0;
      for (const file of result?.paths ?? []) markDirty(file);
    }
    if (changes) {revision++; scheduleAbi();}
    return changes;
  };
  const request = async (method, params, timeout, signal) => {
    const service = await startIfNeeded(params.textDocument.uri); if (!service) return null;
    const entry = entries.get(moduleFor(params.textDocument.uri)); if (!entry || entry.service !== service) throw Error("kotlin-session-changed");
    entry.refs++; entry.lastUsed = Date.now();
    try {return await service.peer.request(method, params, timeout, signal);} finally {entry.refs--; entry.lastUsed = Date.now();}
  };
  const documentDiagnostics = async file => {
    const service = await startIfNeeded(file), entry = entries.get(moduleFor(file));
    if (!service || !entry || entry.service !== service) throw Error("kotlin-session-changed");
    entry.refs++; entry.lastUsed = Date.now();
    try {return await service.documentDiagnostics(file);} finally {entry.refs--; entry.lastUsed = Date.now();}
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
  const references = async (location,signal) => {
    const owner=moduleFor(location.uri);if(!owner)throw Error("android-reference-outside-model");
    const roots=graph.referenceRoots(owner);if(roots.length>16)throw Error("android-reference-coverage-bound");
    const result=[];
    for(const id of roots) {
      if(abort.signal.aborted)throw Error("android-language-session-ended");if(signal?.aborted)throw Object.assign(Error("language-request-cancelled"),{code:-32800});
      const service=await startModule(id),entry=entries.get(id);if(!entry||entry.service!==service)throw Error("kotlin-session-changed");
      entry.refs++;
      try {
        const value=await service.peer.request("kotlin/asterlynReferences",{uri:location.uri,line:location.range.start.line,character:location.range.start.character},25000,signal);
        if(!Array.isArray(value))throw Error("kotlin-reference-result-invalid");
        for(const item of value)if(graph.canReference(moduleFor(item.uri),owner))result.push(item);
      }finally{entry.refs--;entry.lastUsed=Date.now();}
    }
    return result;
  };
  const classDeclaration=(file,position,text)=>latest&&builtRevision===revision&&latest.sourceDigests.get(uri(pathOf(file)))===createHash("sha256").update(text).digest("hex")?latest.classDeclarations(file).find(location=>location.range.start.line===position.line&&position.character>=location.range.start.character&&position.character<location.range.end.character)??null:null;
  const javaDeclarations = async(location,jdtPeer,signal)=>{
    if(!latest)return [];
    const snapshot=latest;
    const result=[];
    const classTarget=snapshot.classDeclarations(location.uri).some(item=>item.range.start.line===location.range.start.line&&item.range.start.character===location.range.start.character);
    for(const anchor of snapshot.javaDeclarations(location.uri,location.range.start).filter(item=>!classTarget||!item.key.includes("#"))){
      const id=snapshot.perModuleRoots.find(item=>inside(item.stubRoot,anchor.stub))?.module;
      if(!id)continue;
      const stable=uri(join(stableRoots.get(id),anchor.stub.slice(snapshot.perModuleRoots.find(item=>item.module===id).stubRoot.length+1)));
      const generation=snapshot.perModuleRoots.find(item=>item.module===id).key,key=JSON.stringify([generation,stable,anchor.key]);
      let pending=javaAnchors.get(key);
      if(!pending){if(javaAnchors.size>=128)javaAnchors.delete(javaAnchors.keys().next().value);pending=jdtPeer.request("workspace/executeCommand",{command:"asterlyn.java.declarationLocation",arguments:[{uri:stable,key:anchor.key}]},25000,abort.signal).then(value=>{if(latest!==snapshot)throw Error("stale-result");return value;});javaAnchors.set(key,pending);pending.catch(()=>{if(javaAnchors.get(key)===pending)javaAnchors.delete(key);});}
      const value=await cancellable(pending,signal);if(latest!==snapshot)throw Error("stale-result");if(signal?.aborted)throw Object.assign(Error("language-request-cancelled"),{code:-32800});
      if(value)result.push(value);
    }
    return result;
  };
  const primeNavigation=async(file,jdtPeer)=>{
    if(!latest||builtRevision!==revision||!jdtPeer)return;
    const doc=documents instanceof Map?documents.get(file):documents[file];if(!doc||latest.sourceDigests.get(uri(pathOf(file)))!==createHash("sha256").update(doc.text).digest("hex"))return;
    const snapshot=latest;navigationPending++;
    try{for(const target of snapshot.classDeclarations(file).slice(0,16)){if(latest!==snapshot||builtRevision!==revision)break;await javaDeclarations(target,jdtPeer,abort.signal);}}
    finally{navigationPending--;}

  };
  const close = async () => {
    abort.abort(); clearTimeout(debounce);
    await Promise.all([...entries.values()].map(closeEntry));
    await kaptPromise?.catch(() => {}); await rm(sessionRoot, {recursive: true, force: true});
  };
  const readDependencySource = (target, document) => entries.get(moduleFor(document))?.service?.readDependencySource(target) ?? null;
  return {moduleFor,references,classDeclaration,primeNavigation,javaDeclarations,extraSources: stableRoots, startIfNeeded,warmProject,readyFor,backendPending:()=>semanticPreparing>0||navigationPending>0||[...entries.values()].some(entry=>entry.starting), documentDiagnostics, readDependencySource, applyOverlay, closeOverlay, refreshSources, awaitJavaAbi: ensureAbi, javaAbiCurrent: file => latest !== null && (file ? !dirtyModules.has(moduleFor(file)) : builtRevision === revision), request, mapJavaDefinition, close};
}
