import { mkdir, readFile, readdir, stat, writeFile, rm, realpath, lstat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { delimiter, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const sourceExt = new Set([".kt", ".kts", ".java"]);
const MAX_FILES = 20000, MAX_FILE_BYTES = 2 * 1024 * 1024, MAX_BYTES = 128 * 1024 * 1024;
const asPath = (value) => value instanceof URL ? fileURLToPath(value) : typeof value === "string" && value.startsWith("file:") ? fileURLToPath(value) : resolve(String(value));
const uri = (value) => pathToFileURL(resolve(value)).href;
const inside = (root, value) => value === root || value.startsWith(`${root}${sep}`);
const readerJar = new URL("./kapt-metadata-reader.jar", import.meta.url);

async function sourceFiles(root, result = [], budget = {entries:0}, depth = 0) {
  if (depth > 64 || ++budget.entries > 100000) throw Error("kapt-source-entry-bound");
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (++budget.entries > 100000) throw Error("kapt-source-entry-bound");
    if (entry.isDirectory()) await sourceFiles(file, result, budget, depth + 1);
    else if (entry.isFile() && sourceExt.has(extname(entry.name))) {if(result.length>=MAX_FILES)throw Error("kapt-source-size-bound");result.push(file);}
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

import {createReadStream} from "node:fs";
import {artifactCache, digest} from "./analysis-artifact-cache.mjs";

const fileHashes = new Map();
async function fileIdentity(path) {
  const canonical=await realpath(path), meta=await stat(canonical,{bigint:true});
  if(!meta.isFile())throw Error("kapt-classpath-file-invalid");
  const identity=`${canonical}:${meta.dev}:${meta.ino}:${meta.size}:${meta.mtimeNs}:${meta.ctimeNs}`;
  if(!fileHashes.has(identity)) {
    if(fileHashes.size>8192)fileHashes.clear();
    const pending=(async()=>{const hash=createHash("sha256");for await(const chunk of createReadStream(canonical))hash.update(chunk);return hash.digest("hex");})();
    fileHashes.set(identity,pending);pending.catch(()=>fileHashes.delete(identity));
  }
  return [canonical,await fileHashes.get(identity)];
}

/** Capture each source once; all module jobs see the same bounded snapshot. */
async function capture(model, overlays, state) {
  const files=new Map(), roots=new Map(), modules=new Map(), budget={entries:0};let bytes=0;
  for(const module of model.modules) {
    const owned=new Set();
    for(const declared of [...new Set([...module.sources,...(module.generatedSources??[])])]) {
      const sourceRoot=resolve(declared);if(!(await stat(sourceRoot).catch(()=>null))?.isDirectory())continue;
      if(!roots.has(sourceRoot))roots.set(sourceRoot,await sourceFiles(sourceRoot,[],budget));
      for(const path of roots.get(sourceRoot)) {
        if(inside(state,path))continue;
        if(!files.has(path)) {
          const meta=await lstat(path);if(!meta.isFile()||meta.isSymbolicLink()||meta.size>MAX_FILE_BYTES)throw Error("kapt-source-size-bound");
          const disk=await readFile(path,"utf8"),text=overlays.get(uri(path))?.text??disk;
          bytes+=Buffer.byteLength(text);if(files.size>=MAX_FILES||bytes>MAX_BYTES)throw Error("kapt-source-size-bound");
          files.set(path,{text,digest:digest(text),dirty:text!==disk,sourceRoot});
        }
        owned.add(path);
      }
    }
    modules.set(module.module,[...owned].sort());
  }
  return {files,modules};
}

function cachedPayload(value, sources) {
  if(!value||value.schema!==1||!Array.isArray(value.files)||value.files.length>20000)return false;
  const seen=new Set();
  return value.files.every(file=>{
    if(typeof file.path!=="string"||!file.path.endsWith(".java")||file.path.startsWith("/")||/[\\\u0000-\u001f]/u.test(file.path)||file.path.split("/").some(part=>!part||part===".."||part===".")||seen.has(file.path)||typeof file.text!=="string"||Buffer.byteLength(file.text)>MAX_FILE_BYTES||!file.lines||typeof file.lines!=="object"||Array.isArray(file.lines))return false;
    seen.add(file.path);
    return Object.entries(file.lines).every(([key,entry])=>key.length<=8192&&entry&&sources.has(entry.path)&&Number.isSafeInteger(entry.line)&&entry.line>=0&&entry.line<=sources.get(entry.path).text.length);
  });
}

export async function generateKaptStubs({model,stateDirectory,java,compilerJar,kaptJar,runtimeJars=[],overlays={},timeoutMs=120000,signal,onProgress=()=>{},cacheDirectory,onCacheEvent=()=>{},previous,concurrency=1}) {
  if(!model?.modules?.length||!compilerJar||!kaptJar)throw Error("kapt-stub-configuration-invalid");
  const state=resolve(asPath(stateDirectory)),root=join(state,`kapt-stubs-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const abort=new AbortController(), cancel=()=>abort.abort();signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted)abort.abort();
  const check=()=>{if(abort.signal.aborted)throw Error("kapt-generation-cancelled");};
  try {
    const overlayMap=overlays instanceof Map?overlays:new Map(Object.entries(overlays));
    const snapshot=await capture(model,overlayMap,state),cache=await artifactCache(cacheDirectory);
    const javaExecutable=asPath(java).endsWith(`${sep}java`)?asPath(java):join(asPath(java),"bin","java");
    const runtime=runtimeJars.map(asPath).filter(jar=>!jar.includes("kotlin-scripting"));
    const tools=[];for(const path of [javaExecutable,asPath(compilerJar),asPath(kaptJar),fileURLToPath(readerJar),...runtime]){check();tools.push(await fileIdentity(path));}
    const byId=new Map(model.modules.map(module=>[module.module,module]));
    const closure=(module,seen=new Set())=>{if(seen.has(module.module))return [];seen.add(module.module);return [module,...(module.projectDependencies??[]).flatMap(dep=>{const target=byId.get(dep.module??dep);if(!target)throw Error("android-module-dependency-missing");return closure(target,seen);})];};
    let materializedBytes=0;
    const boundedWrite=async(path,text)=>{materializedBytes+=Buffer.byteLength(text);if(materializedBytes>512*1024*1024)throw Error("kapt-materialization-bound");await writeFile(path,text);};
    const artifacts=new Map(),originMaps=new Map(),sourceDigests=new Map([...snapshot.files].map(([path,file])=>[uri(path),file.digest]));
    const perModuleRoots=new Array(model.modules.length);let completed=0;
    const jobs=model.modules.map((module,index)=>({module,index}));
    jobs.sort((a,b)=>(b.module.module===model.selection?.module?1:0)-(a.module.module===model.selection?.module?1:0));
    const run=async({module,index})=>{
      check();const started=performance.now(),deps=closure(module),paths=[...new Set(deps.flatMap(dep=>snapshot.modules.get(dep.module)??[]))].sort();
      const sources=new Map(paths.map(path=>[path,snapshot.files.get(path)]));
      const classpath=[...(module.bootClasspath??[]),...(module.compileClasspath??[])].map(item=>resolve(item));
      const libraries=[];for(const path of classpath){check();libraries.push(await fileIdentity(path));}
      const key=digest(JSON.stringify({schema:2,root:model.buildRoot,selection:model.selection,modules:deps,tools,libraries,sources:paths.map(path=>[path,snapshot.files.get(path).digest])}));
      const moduleRoot=join(root,`module-${index}`),stubsRoot=join(moduleRoot,"stubs"),classesRoot=join(moduleRoot,"classes");
      await mkdir(stubsRoot,{recursive:true});await mkdir(classesRoot,{recursive:true});
      let payload=previous?.artifacts?.get(key),kind=payload?"session-hit":"miss";
      if(!payload&&cache){payload=await cache.read(key);if(payload)kind="hit";}
      if(payload&&!cachedPayload(payload,sources)){payload=null;kind="miss";}
      if(!payload) {
        const sourceRoot=join(moduleRoot,"sources"),generatedRoot=join(moduleRoot,"generated");await mkdir(generatedRoot,{recursive:true});
        const originPaths=new Map(),inputs=[],javaRoots=[];
        for(const [sourceIndex,source]of paths.entries()) {
          check();const privateRoot=join(sourceRoot,digest(snapshot.files.get(source).sourceRoot).slice(0,16)),target=join(privateRoot,relative(snapshot.files.get(source).sourceRoot,source));await mkdir(join(target,".."),{recursive:true});await boundedWrite(target,snapshot.files.get(source).text);
          originPaths.set(target,source);if(extname(target)===".java")javaRoots.includes(privateRoot)||javaRoots.push(privateRoot);else inputs.push(target);
        }
        // Java-only modules do not require a Kotlin compiler process.
        payload={schema:1,files:[]};
        if(inputs.length) {
          const cp=[asPath(compilerJar),asPath(kaptJar),...runtime].join(delimiter),compileClasspath=classpath.length?classpath.join(delimiter):runtime.join(delimiter);
          const compilerArgs=["-Xuse-k2-kapt",`-Xplugin=${asPath(kaptJar)}`,"-P","plugin:org.jetbrains.kotlin.kapt3:aptMode=stubs","-P",`plugin:org.jetbrains.kotlin.kapt3:stubs=${stubsRoot}`,"-P",`plugin:org.jetbrains.kotlin.kapt3:classes=${classesRoot}`,"-P",`plugin:org.jetbrains.kotlin.kapt3:sources=${generatedRoot}`,"-P","plugin:org.jetbrains.kotlin.kapt3:correctErrorTypes=true","-P",`plugin:org.jetbrains.kotlin.kapt3:apclasspath=${asPath(kaptJar)}`,"-classpath",compileClasspath,"-d",classesRoot,...javaRoots.map(path=>`-Xjava-source-roots=${path}`),...inputs];
          const quote=value=>/[\s"\\]/u.test(value)?`"${value.replaceAll("\\","\\\\").replaceAll('"','\\"')}"`:value;
          const argFile=join(moduleRoot,"compiler.args");await writeFile(argFile,compilerArgs.map(quote).join("\n")+"\n");
          await exec(javaExecutable,["-Xmx768m","-cp",cp,"org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",`@${argFile}`],{maxBuffer:32*1024*1024,timeout:timeoutMs,killSignal:"SIGKILL",signal:abort.signal});
          const metadata=(await allFiles(stubsRoot)).filter(path=>path.endsWith(".kapt_metadata")),manifest=join(moduleRoot,"metadata-manifest.txt");await writeFile(manifest,metadata.join("\n")+"\n");
          const batch=JSON.parse((await exec(javaExecutable,["-Xmx128m","-jar",fileURLToPath(readerJar),manifest],{maxBuffer:32*1024*1024,timeout:timeoutMs,killSignal:"SIGKILL",signal:abort.signal})).stdout);
          const owned=new Set(snapshot.modules.get(module.module));
          for(const file of metadata) {
            const parsed=batch.files[file];if(!parsed||!Object.values(parsed.lines??{}).some(entry=>owned.has(originPaths.get(entry.path))))continue;
            const lines=Object.fromEntries(Object.entries(parsed.lines??{}).filter(([,entry])=>originPaths.has(entry.path)&&Number.isSafeInteger(entry.line)&&entry.line>=0&&entry.line<=snapshot.files.get(originPaths.get(entry.path)).text.length).map(([key,entry])=>[key,{path:originPaths.get(entry.path),line:entry.line}]));
            const path=file.replace(/\.kapt_metadata$/u,".java"),text=await readFile(path,"utf8");payload.files.push({path:relative(stubsRoot,path).split(sep).join("/"),text,lines});
          }
        }
        if(!cachedPayload(payload,sources))throw Error("kapt-artifact-invalid");
        // Never persist artifacts produced from any dirty source in this module's closure.
        check();if(cache&&!paths.some(path=>snapshot.files.get(path).dirty))await cache.write(key,payload);
      }
      check();const metadata=[];
      for(const file of payload.files) {
        const stub=join(stubsRoot,...file.path.split("/"));await mkdir(join(stub,".."),{recursive:true});await boundedWrite(stub,file.text);
        const meta=stub.replace(/\.java$/u,".kapt_metadata");originMaps.set(meta,{lines:file.lines});metadata.push(meta);
      }
      artifacts.set(key,payload);perModuleRoots[index]={module:module.module,key,stubRoot:stubsRoot,classRoot:classesRoot,metadata,allMetadata:metadata};
      completed++;onProgress({phase:"sources",completed,total:model.modules.length,unit:"modules"});onCacheEvent({code:`kotlin-module-cache-${kind}`,moduleHash:digest(module.module).slice(0,12),durationMs:Math.round(performance.now()-started)});
    };
    let cursor=0,firstError;const worker=async()=>{while(cursor<jobs.length){const job=jobs[cursor++];try{await run(job);}catch(error){firstError??=error;abort.abort();throw error;}}};
    const outcomes=await Promise.allSettled(Array.from({length:Math.min(jobs.length,Math.max(1,Math.min(2,concurrency)))},worker));
    const failed=outcomes.find(outcome=>outcome.status==="rejected");if(failed)throw firstError;
    check();
    // External edits during compilation cannot publish a stale disk snapshot.
    for(const [path,file]of snapshot.files)if(!overlayMap.has(uri(path))&&digest(await readFile(path,"utf8"))!==file.digest)throw Error("kapt-source-changed-during-generation");
    return {root,perModuleRoots,sourceDigests,artifacts,javaDeclarations:(sourceUri,position)=>{
      const source=asPath(sourceUri),text=snapshot.files.get(source)?.text;if(text===undefined)return [];
      const lines=text.split("\n");if(!Number.isSafeInteger(position?.line)||position.line<0||position.line>=lines.length||!Number.isSafeInteger(position.character)||position.character<0||position.character>lines[position.line].length)return [];
      const offset=lines.slice(0,position.line).reduce((sum,line)=>sum+line.length+1,0)+position.character;
      const found=[];let closest=-1;
      for(const [metadata,value]of originMaps)for(const [key,entry]of Object.entries(value.lines)) {
        if(entry.path!==source||entry.line>offset)continue;
        const between=text.slice(entry.line,offset);if(between.includes("\n"))continue;
        if(entry.line>closest){closest=entry.line;found.length=0;}if(entry.line===closest)found.push({stub:metadata.replace(/\.kapt_metadata$/u,".java"),key});
      }
      return found.slice(0,32);
    },mapOriginByKey:async(stubUri,descriptor)=>{
      const path=asPath(stubUri),entry=originMaps.get(path.replace(/\.java$/u,".kapt_metadata"))?.lines?.[descriptor];if(!entry)return null;
      const source=snapshot.files.get(entry.path);if(!source)return null;
      const before=source.text.slice(0,entry.line),position={line:(before.match(/\n/gu)??[]).length,character:before.slice(before.lastIndexOf("\n")+1).length};
      return {uri:uri(entry.path),range:{start:position,end:position}};
    }};
  }catch(error){abort.abort();await rm(root,{recursive:true,force:true});throw error;}finally{signal?.removeEventListener("abort",cancel);}
}
export default {generateKaptStubs};
