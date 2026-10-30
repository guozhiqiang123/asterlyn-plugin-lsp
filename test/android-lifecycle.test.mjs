import assert from "node:assert/strict";
import test from "node:test";
import {spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {RpcPeer} from "../server-programs/rpc.mjs";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test("project model starts without an open file; real failures stop indexing and tracing remains opt-in",async()=>{
 const state=await mkdtemp(join(tmpdir(),"asterlyn-language-lifecycle-"));
 const child=spawn(process.execPath,[fileURLToPath(new URL("../server-programs/android-server.mjs",import.meta.url))],{stdio:["pipe","pipe","pipe"]});
 const peer=new RpcPeer(child.stdout,child.stdin),statuses=[],traces=[],requests=[];
 child.stderr.resume();peer.on("fatal",()=>{});
 peer.on("request",request=>{requests.push(request.method);if(request.method==="asterlyn/workspaceModel")peer.reject(request.id,-32000,"repository-credentials-missing");else peer.reject(request.id,-32601);});
 peer.on("notification",event=>{if(event.method==="experimental/serverStatus")statuses.push(event.params);if(event.method==="asterlyn/trace")traces.push(event.params);});
 try{
  await peer.request("initialize",{initializationOptions:{analysis:{stateDirectory:state}}},2000);peer.notify("initialized",{});
  for(let n=0;n<100&&statuses.at(-1)?.progress?.phase!=="failed";n++)await pause(10);
  assert.deepEqual(requests,["asterlyn/workspaceModel"]);assert.equal(statuses.at(-1).code,"repository-credentials-missing");assert.equal(statuses.at(-1).health,"error");assert.equal(statuses.at(-1).progress.phase,"failed");assert.equal(traces.length,0);
  const request=()=>peer.request("textDocument/definition",{textDocument:{uri:"file:///Main.kt"},position:{line:0,character:0}},2000);
  await assert.rejects(request(),error=>error.code===-32603,"configuration failure must not be reported as ordinary indexing (-32801)");
  peer.notify("asterlyn/setDebugTracing",{enabled:true});await assert.rejects(request());assert.equal(traces.at(-1).code,"repository-credentials-missing");
  const count=traces.length;peer.notify("asterlyn/setDebugTracing",{enabled:false});await assert.rejects(request());assert.equal(traces.length,count);
  assert.ok(!JSON.stringify([...statuses,...traces]).includes("Main.kt"));
  await peer.request("shutdown",null,2000);peer.notify("exit",null);
 }finally{peer.close();child.kill("SIGKILL");await rm(state,{recursive:true,force:true});}
});
