import {mkdir,mkdtemp,copyFile,writeFile,stat,rm,rename} from 'node:fs/promises';import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';import {join,dirname} from 'node:path';
export async function stageComponents(expected,input,output){
 if(input.size!==expected.length||new Set(expected.map(c=>c.id)).size!==expected.length||expected.some(c=>!input.has(c.id)||!/^[-a-z0-9]+$/.test(c.id)||!/^[-a-zA-Z0-9.]+$/.test(c.version)))throw Error('Supply exactly the declared portable component identities');
 await mkdir(dirname(output),{recursive:true});const stage=await mkdtemp(join(dirname(output),'.component-staging-')),summary=[];
 try{
  for(const component of expected){const source=input.get(component.id),hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);const digest=hash.digest('hex');if(`sha256:${digest}`!==component.archiveDigest)throw Error(`Component archive differs from frozen manifest: ${component.id}`);const asset=`${component.id}-${component.version}.tar.gz`;await copyFile(source,join(stage,asset));summary.push({...component,asset,bytes:(await stat(source)).size});}
  await writeFile(join(stage,'components.json'),JSON.stringify({schemaVersion:1,release:'analysis-components-2026-10-30',components:summary},null,2)+'\n');
  await writeFile(join(stage,'SHA256SUMS'),summary.map(c=>`${c.archiveDigest.slice(7)}  ${c.asset}\n`).join(''));
  await rm(output,{recursive:true,force:true});await rename(stage,output);return summary;
 }finally{await rm(stage,{recursive:true,force:true});}
}
