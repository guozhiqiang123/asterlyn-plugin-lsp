import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {RpcPeer} from '../server-programs/rpc.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const [root,modelFile,optionFile,file,marker,evidence]=process.argv.slice(2);
if(!evidence)throw Error('usage: test-android-navigation.mjs <package> <model> <options> <relative-file> <declaration-marker> <evidence>');
const bytes=await readFile(modelFile),model=JSON.parse(bytes),options=JSON.parse(await readFile(optionFile)),state=await mkdtemp(join(tmpdir(),'asterlyn-navigation-latency-'));
const path=join(model.buildRoot,file),text=await readFile(path,'utf8'),uri=pathToFileURL(path).href,at=text.indexOf(marker)+marker.length-1,prefix=text.slice(0,at),position={line:prefix.split('\n').length-1,character:prefix.slice(prefix.lastIndexOf('\n')+1).length};assert.ok(text.includes(marker),'missing declaration marker');
const began=Date.now();
const child=spawn(process.execPath,[join(root,'server-programs/android-server.mjs')],{stdio:['pipe','pipe','pipe'],detached:true}),peer=new RpcPeer(child.stdout,child.stdin),summary={samples:[],trace:[],rpc:[],peakRssKiB:0};let ready=false;
child.stderr.on('data',data=>{for(const line of data.toString().split('\n'))try{summary.rpc.push(JSON.parse(line));}catch{}});
peer.on('request',r=>r.method==='asterlyn/workspaceModel'?peer.reply(r.id,{path:modelFile,schema:1,bytes:bytes.length,generation:1,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')}):peer.reply(r.id,null));
peer.on('notification',n=>{if(n.method==='experimental/serverStatus'&&n.params.progress?.phase==='ready')ready=true;if(n.method==='asterlyn/trace')summary.trace.push(n.params);});
const sampler=setInterval(()=>{try{const rows=execFileSync('ps',['-axo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/u).map(Number));const owned=new Set([child.pid]);for(let i=0;i<20;i++)for(const [pid,parent]of rows)if(owned.has(parent))owned.add(pid);summary.peakRssKiB=Math.max(summary.peakRssKiB,rows.filter(([pid])=>owned.has(pid)).reduce((sum,row)=>sum+row[2],0));}catch{}},500);sampler.unref();
try{await peer.request('initialize',{rootUri:pathToFileURL(model.buildRoot).href,initializationOptions:{analysis:{...options,stateDirectory:state}}});peer.notify('textDocument/didOpen',{textDocument:{uri,languageId:'kotlin',version:1,text}});peer.notify('initialized',{});const deadline=Date.now()+600000;while(!ready){if(Date.now()>deadline)throw Error('index-timeout');await new Promise(r=>setTimeout(r,100));}

summary.readyMs=Date.now()-began;
for(let i=0;i<4;i++){const begin=performance.now(),rpcBegin=summary.rpc.length;const defs=await peer.request('textDocument/definition',{textDocument:{uri},position},60000);const afterDefinition=performance.now();const refs=await peer.request('textDocument/references',{textDocument:{uri},position,context:{includeDeclaration:false}},60000);summary.samples.push({definitionMs:Math.round(afterDefinition-begin),referencesMs:Math.round(performance.now()-afterDefinition),totalMs:Math.round(performance.now()-begin),definitionCount:Array.isArray(defs)?defs.length:defs?1:0,referenceCount:refs.length,referenceDigest:createHash('sha256').update(JSON.stringify(refs.map(item=>[item.uri,item.range]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex'),rpc:summary.rpc.slice(rpcBegin)});await writeFile(evidence,JSON.stringify(summary,null,2));}
assert.ok(summary.samples[0].referenceCount>0,'references must be nonempty');assert.equal(new Set(summary.samples.map(item=>item.referenceDigest)).size,1,'repeated query must preserve exact locations');
summary.sourceUnchanged=(await readFile(path,'utf8'))===text;
}catch(error){summary.failure=String(error.stack);process.exitCode=1;}finally{clearInterval(sampler);try{await peer.request('shutdown',null,5000);}catch{}try{process.kill(-child.pid,'SIGTERM');}catch{}peer.close();await rm(state,{recursive:true,force:true});await writeFile(evidence,JSON.stringify(summary,null,2));console.log(JSON.stringify({samples:summary.samples.map(({rpc,...r})=>r),failure:summary.failure,sourceUnchanged:summary.sourceUnchanged}));}
