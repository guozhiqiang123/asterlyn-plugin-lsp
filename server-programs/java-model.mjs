import { mkdir, writeFile, stat, realpath, copyFile, readdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {createHash} from "node:crypto";
const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const nameOf = (module) => `android-${createHash("sha256").update(module).digest("hex").slice(0,16)}`;
/** Each module keeps its own classpath and selected source set in a private Eclipse project. */
export async function createJavaModel(model, stateDirectory, extraSources = new Map()) {
  if (model?.schemaVersion !== 1 || model.origin !== "agp-v2" || !Array.isArray(model.modules) || !model.modules.length || model.modules.length > 256) throw Error("unsupported-android-model");
  const root = await realpath(model.buildRoot); const projects=[];let sourceCount=0,libraryCount=0,pathCount=0;
  const modules=new Set(model.modules.map(module=>module.module));if(modules.size!==model.modules.length)throw Error("duplicate-model-module");
  const checked = value => { if (typeof value !== "string" || !isAbsolute(value) || value.length > 4096 || value.includes("\0") || ++pathCount > 20000) throw Error("android-model-path-bound"); return value; };
  for(const module of model.modules){
    const name=nameOf(module.module),project=join(stateDirectory,name); await mkdir(join(project,".settings"),{recursive:true});
    const sources=new Set(),libraries=new Map();
    for (const source of [...module.sources, ...(extraSources.has(module.module)?[extraSources.get(module.module)]:[]), ...(Array.isArray(module.generatedSources)?module.generatedSources:module.generatedSources?.existing ?? [])]) {const path=checked(source);if((await stat(path).catch(()=>null))?.isDirectory())sources.add(await realpath(path));}
    for(const file of [...module.bootClasspath,...module.compileClasspath]){const path=checked(file);if(!(await stat(path).catch(()=>null))?.isFile())throw Error("android-compile-artifact-missing");libraries.set(await realpath(path),null);}
    for(const attachment of module.sourceAttachments??[]){const binary=await realpath(checked(attachment.binary));const source=attachment.source??attachment.sources?.[0];if(source&&libraries.has(binary)&&((await stat(checked(source)).catch(()=>null))?.isFile() || (await stat(source).catch(()=>null))?.isDirectory()))libraries.set(binary,await realpath(source));}
    const deps=(module.projectDependencies??[]).map(dependency=>typeof dependency==="string"?dependency:dependency.module??dependency.projectPath);
    if(deps.some(dep=>!modules.has(dep)))throw Error("android-model-dependency-missing");
    const sourceList=[...sources],references=deps.map(nameOf);
    await writeFile(join(project,".project"),`<?xml version="1.0"?><projectDescription><name>${name}</name><comment></comment><projects>${references.map(name=>`<project>${name}</project>`).join("")}</projects><buildSpec><buildCommand><name>org.eclipse.jdt.core.javabuilder</name><arguments></arguments></buildCommand></buildSpec><natures><nature>org.eclipse.jdt.core.javanature</nature></natures><linkedResources>${sourceList.map((path,index)=>`<link><name>source${index}</name><type>2</type><locationURI>${xml(pathToFileURL(path).href)}</locationURI></link>`).join("")}</linkedResources></projectDescription>`);
    await writeFile(join(project,".classpath"),`<?xml version="1.0"?><classpath>${sourceList.map((_,index)=>`<classpathentry kind="src" path="source${index}"/>`).join("")}${references.map(name=>`<classpathentry kind="src" path="/${name}" exported="true"/>`).join("")}${[...libraries].map(([path,source])=>`<classpathentry kind="lib" path="${xml(path)}"${source?` sourcepath="${xml(source)}"`:""}/>`).join("")}<classpathentry kind="output" path="bin"/></classpath>`);
    const level=module.javaSourceLevel??module.javaSourceTarget??"17";if(!/^(?:1\.8|\d{1,2})$/u.test(level))throw Error("unsupported-java-source-level");
    await writeFile(join(project,".settings/org.eclipse.jdt.core.prefs"),`eclipse.preferences.version=1\norg.eclipse.jdt.core.compiler.codegen.targetPlatform=${level}\norg.eclipse.jdt.core.compiler.compliance=${level}\norg.eclipse.jdt.core.compiler.source=${level}\n`);
    sourceCount+=sources.size;libraryCount+=libraries.size;projects.push(project);
  }
  if(!sourceCount||!libraryCount)throw Error("android-model-empty");
  return {root,project:projects[0],projects,sourceCount,libraryCount};
}
export async function prepareJdt(jdt,stateDirectory){
  const plugins=join(jdt,"plugins"),files=await readdir(plugins),launchers=files.filter(file=>/^org\.eclipse\.equinox\.launcher_[\d.].*\.jar$/u.test(file));if(launchers.length!==1)throw Error("invalid-jdt-component");
  const candidates=process.platform==="darwin"?[process.arch==="arm64"?"config_mac_arm":"config_mac"]:process.platform==="win32"?["config_win"]:[process.arch==="arm64"?"config_linux_arm":"config_linux"];
  const configuration=join(stateDirectory,"configuration");await mkdir(configuration,{recursive:true});let copied=false;
  for(const candidate of candidates)if((await stat(join(jdt,candidate,"config.ini")).catch(()=>null))?.isFile()){await copyFile(join(jdt,candidate,"config.ini"),join(configuration,"config.ini"));copied=true;break;}
  if(!copied)throw Error("jdt-platform-unavailable");
  return {launcher:join(plugins,launchers[0]),configuration,data:join(stateDirectory,"workspace")};
}
