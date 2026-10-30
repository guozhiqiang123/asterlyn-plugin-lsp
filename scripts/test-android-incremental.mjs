// Real semantic/cache acceptance in an agent-owned copy, never in the user's project.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm,readdir,realpath,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {RpcPeer} from '../server-programs/rpc.mjs';
const [inputModel,optionFile,evidence]=process.argv.slice(2);if(!evidence)throw Error('usage: test-android-incremental.mjs <fixture-model> <options> <evidence>');
const scratch=await realpath(await mkdtemp(join(tmpdir(),'lsp incremental 中文 '))),root=join(scratch,'project'),cache=join(scratch,'cache');await mkdir(cache,{mode:0o700});
const original=JSON.parse(await readFile(inputModel,'utf8')),options=JSON.parse(await readFile(optionFile,'utf8'));
await cp(original.buildRoot,root,{recursive:true,filter:path=>!['.gradle','build'].includes(basename(path))});
const model=JSON.parse(JSON.stringify(original).replaceAll(original.buildRoot,root));
const files={
 KThing:'common/src/main/kotlin/com/example/common/KThing.kt',
 JThing:'common/src/main/java/com/example/common/JThing.java',
 KConsumer:'app/src/main/kotlin/com/example/fixture/KConsumer.kt',
 JConsumer:'app/src/main/java/com/example/fixture/JConsumer.java',
};
const texts={KThing:'package com.example.common\nclass KThing { fun foo(): String = "ok" }\n',JThing:'package com.example.common;\npublic class JThing { public String bar() { return "ok"; } }\n',KConsumer:'package com.example.fixture\nimport com.example.common.KThing\nimport com.example.common.JThing\nclass KConsumer { fun calls() = KThing().foo() + JThing().bar() }\n',JConsumer:'package com.example.fixture;\nimport com.example.common.KThing;\nimport com.example.common.JThing;\npublic class JConsumer { public String calls() { return new KThing().foo() + new JThing().bar(); } }\n'};
for(const [name,path]of Object.entries(files)){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),texts[name]);}
await writeFile(join(root,'app/src/main/kotlin/com/example/fixture/OtherUse.kt'),'package other\nclass KThing { fun foo() = "other" }\nclass OtherUse { fun use() = KThing().foo() }\n');
const modelBytes=Buffer.from(JSON.stringify(model)),modelFile=join(scratch,'model.json');await writeFile(modelFile,modelBytes);
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const summary={checks:[],runs:[],scratch};const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,limit=60000){const end=Date.now()+limit;while(Date.now()<end){const value=await predicate();if(value)return value;await sleep(100);}throw Error('acceptance-condition-timeout');}
async function start(){
 const state=await mkdtemp(join(scratch,'session-')),child=spawn(process.execPath,[resolve('server-programs/android-server.mjs')],{stdio:['pipe','pipe','pipe']});
 const peer=new RpcPeer(child.stdout,child.stdin),events=[],docs=new Map(),began=Date.now();let stderr=0;child.stderr.on('data',data=>stderr+=data.length);const exited=new Promise(resolve=>child.once('exit',resolve));
 peer.on('notification',event=>events.push(event));peer.on('request',request=>{if(request.method==='asterlyn/workspaceModel')peer.reply(request.id,{path:modelFile,digest:hash(modelBytes),bytes:modelBytes.length,generation:1,schema:1});else if(request.method==='workspace/diagnostic/refresh')peer.reply(request.id,null);else peer.reject(request.id,-32601);});
 await peer.request('initialize',{rootUri:pathToFileURL(root).href,initializationOptions:{analysis:{...options,stateDirectory:state,cacheDirectory:cache,debugTrace:true}}});peer.notify('initialized',{});
 await until(()=>events.some(event=>event.method==='experimental/serverStatus'&&event.params?.progress?.phase==='ready'&&event.params.health==='ok'));
 const counts=()=>{const value={};for(const event of events)if(event.method==='asterlyn/trace'&&event.params.code.startsWith('kotlin-module-cache-'))value[event.params.code]=(value[event.params.code]??0)+1;return value;};
 const run={readyMs:Date.now()-began,cache:counts()};summary.runs.push(run);
 for(const [name,path]of Object.entries(files)){const doc={uri:pathToFileURL(join(root,path)).href,text:texts[name],version:1,languageId:path.endsWith('.java')?'java':'kotlin'};docs.set(name,doc);peer.notify('textDocument/didOpen',{textDocument:doc});}
 const position=(doc,symbol)=>{const offset=doc.text.indexOf(symbol);assert.ok(offset>=0);const before=doc.text.slice(0,offset+1);return {line:before.split('\n').length-1,character:before.slice(before.lastIndexOf('\n')+1).length};};
 const ask=async(method,name,symbol,extra={})=>{summary.active={method,name};const doc=docs.get(name);return until(async()=>{try{return {value:await peer.request('textDocument/'+method,{textDocument:{uri:doc.uri},position:position(doc,symbol),...extra},45000)};}catch(error){if(error.code===-32801)return null;throw error;}},90000).then(result=>result.value);};
 const change=(name,text)=>{const doc=docs.get(name);doc.version++;doc.text=text;peer.notify('textDocument/didChange',{textDocument:{uri:doc.uri,version:doc.version},contentChanges:[{text}]});};
 const finish=async()=>{try{await peer.request('shutdown',null,10000);}finally{peer.close();child.kill('SIGTERM');await Promise.race([exited,sleep(5000)]);if(child.exitCode===null)child.kill('SIGKILL');run.stderrBytes=stderr;}};
 return {ask,change,counts,events,docs,finish};
}
let client;
try{
 client=await start();assert.equal(summary.runs[0].cache['kotlin-module-cache-miss'],2);await client.finish();client=null;
 client=await start();assert.equal(summary.runs[1].cache['kotlin-module-cache-hit'],2);assert.equal(summary.runs[1].cache['kotlin-module-cache-miss']??0,0);summary.checks.push('cold-to-warm-with-zero-compilation');
 for(const [name,symbol,target]of [['JConsumer','foo()','KThing.kt'],['KConsumer','foo()','KThing.kt'],['JConsumer','bar()','JThing.java'],['KConsumer','bar()','JThing.java']]){
  const value=await client.ask('definition',name,symbol),locations=Array.isArray(value)?value:[value];assert.ok(locations.some(item=>item?.uri?.endsWith(target)));}
 summary.checks.push('four-definition-directions');
 for(const [name,symbol]of [['KThing','foo()'],['JThing','bar()'],['KThing','KThing {'],['JThing','JThing {']]){
  const locations=await client.ask('references',name,symbol,{context:{includeDeclaration:false}});
  summary.references??={};summary.references[name]=locations;summary.lastTrace=client.events.filter(event=>event.method==='asterlyn/trace').slice(-6);assert.ok(locations.some(item=>item.uri.endsWith('JConsumer.java')),name+' Java usages missing');assert.ok(locations.some(item=>item.uri.endsWith('KConsumer.kt')),name+' Kotlin usages missing');assert.ok(!locations.some(item=>item.uri.endsWith('OtherUse.kt')),'same-name symbol must not be merged');}
 summary.checks.push('cross-module-java-and-kotlin-reference-aggregation');
 const filesBefore=(await readdir(join(cache,'kapt-v1'))).sort(),cacheBefore=client.counts(),at=client.events.length;
 client.change('KConsumer',texts.KConsumer+'// unsaved leaf edit\n');
 assert.ok(await client.ask('hover','JThing','bar()'));summary.checks.push('unrelated-module-java-remains-available');
 await until(()=>client.events.slice(at).some(event=>event.method==='asterlyn/trace'&&event.params.code==='kotlin-abi-completed'));
 await until(()=>{const counts=client.counts();return (counts['kotlin-module-cache-miss']??0)>(cacheBefore['kotlin-module-cache-miss']??0);});
 const after=client.counts();assert.equal(after['kotlin-module-cache-miss']-(cacheBefore['kotlin-module-cache-miss']??0),1);assert.equal(after['kotlin-module-cache-session-hit']-(cacheBefore['kotlin-module-cache-session-hit']??0),1);
 assert.deepEqual((await readdir(join(cache,'kapt-v1'))).sort(),filesBefore);summary.checks.push('leaf-only-rebuild-and-dirty-artifacts-not-persisted');
 await writeFile(join(root,files.KConsumer),client.docs.get('KConsumer').text);
 await until(async()=>(await readdir(join(cache,'kapt-v1'))).length>filesBefore.length);summary.checks.push('saved-overlay-promoted-without-recompile');
 const newPath=join(root,'common/src/main/kotlin/com/example/common/NewValue.kt');await writeFile(newPath,'package com.example.common\nobject NewValue { fun fresh(): String = "new" }\n');
 client.change('KConsumer',texts.KConsumer.replace('KThing().foo()','com.example.common.NewValue.fresh()'));
 await until(async()=>{const value=await client.ask('definition','KConsumer','fresh()');return (Array.isArray(value)?value:[value]).some(item=>item?.uri?.endsWith('NewValue.kt'));});summary.checks.push('new-unopened-external-source-discovered');
 const renamed=join(root,'common/src/main/kotlin/com/example/common/RenamedValue.kt');await rename(newPath,renamed);await until(async()=>{const value=await client.ask('definition','KConsumer','fresh()');return (Array.isArray(value)?value:[value]).some(item=>item?.uri?.endsWith('RenamedValue.kt'));});summary.checks.push('renamed-source-remapped');
 await rm(renamed);await until(async()=>{const value=await client.ask('definition','KConsumer','fresh()');return !(Array.isArray(value)?value:[value]).some(item=>item?.uri?.endsWith('NewValue.kt'));});summary.checks.push('deleted-source-removed');
 await client.finish();client=null;summary.success=true;
}catch(error){summary.failure={message:error.message,code:error.code,stack:error.stack};process.exitCode=1;}finally{if(client)summary.tail=client.events.filter(event=>event.method==='asterlyn/trace'||event.method==='experimental/serverStatus').slice(-35);await client?.finish().catch(()=>{});await writeFile(evidence,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));if(summary.success)await rm(scratch,{recursive:true,force:true});}
