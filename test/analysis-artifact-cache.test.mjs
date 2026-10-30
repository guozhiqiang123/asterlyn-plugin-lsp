import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink,stat} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {artifactCache,digest} from "../server-programs/analysis-artifact-cache.mjs";

test("content artifacts survive reopen, concurrent writes and corrupt entries fail as misses",async()=>{
 const root=await mkdtemp(join(tmpdir(),"lsp-artifacts-"));try{
 const key=digest("source snapshot"), cache=await artifactCache(root);
 const value={schema:1,files:[{path:"example/Value.java",text:"class Value {}",lines:{}}]};
 assert.equal(await cache.write(key,value),true);
 assert.deepEqual(await (await artifactCache(root)).read(key),value);
 await Promise.all([cache.write(key,value),cache.write(key,value)]);
 assert.deepEqual(await cache.read(key),value);
 const file=join(root,"kapt-v1",`${key}.gz`);if(process.platform!=="win32")assert.equal((await stat(file)).mode&0o777,0o600);
 await writeFile(file,"interrupted artifact");assert.equal(await cache.read(key),null);
 assert.equal(await cache.write(key,value),true);assert.deepEqual(await cache.read(key),value);
 assert.equal(await cache.read("../outside"),null);
 assert.deepEqual((await readdir(join(root,"kapt-v1"))).filter(name=>name.startsWith(".write-")),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("redirected artifact directories and files never become trusted cache entries",async()=>{
 const root=await mkdtemp(join(tmpdir(),"lsp-cache-")),outside=await mkdtemp(join(tmpdir(),"lsp-outside-"));try{
 await symlink(outside,join(root,"kapt-v1"),process.platform==="win32"?"junction":"dir");
 assert.equal(await artifactCache(root),null);assert.deepEqual(await readdir(outside),[]);
 await rm(join(root,"kapt-v1"));const cache=await artifactCache(root),key=digest("entry");
 await writeFile(join(outside,"payload"),"private");await symlink(join(outside,"payload"),join(root,"kapt-v1",`${key}.gz`));
 assert.equal(await cache.read(key),null);assert.equal(await readFile(join(outside,"payload"),"utf8"),"private");
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
