import {constants} from "node:fs";
import {open, mkdir, lstat, readdir, rename, rm, opendir} from "node:fs/promises";
import {join} from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {gzipSync, gunzipSync} from "node:zlib";

export const digest = value => createHash("sha256").update(value).digest("hex");
const MAX_ENTRY = 16 * 1024 * 1024, MAX_DECODED = 64 * 1024 * 1024;
const MAX_ENTRIES = 128, MAX_TOTAL = 256 * 1024 * 1024;
/** Immutable, content-addressed artifacts. No source overlays or mutable JVM state. */
export async function artifactCache(parent) {
  if (!parent) return null;
  const root = join(parent, "kapt-v1");
  try {
    const base = await lstat(parent); if (!base.isDirectory() || base.isSymbolicLink()) return null;
    await mkdir(root, {mode:0o700}).catch(error => {if(error.code!=="EEXIST")throw error;});
    const info=await lstat(root); if(!info.isDirectory()||info.isSymbolicLink())return null;
    let count=0;for await(const entry of await opendir(root)) {
      if(++count>1024)return null;
      if(/^\.write-[a-f0-9-]+$/u.test(entry.name)) {
        const file=join(root,entry.name),meta=await lstat(file).catch(()=>null);
        if(meta?.isFile()&&meta.mtimeMs<Date.now()-3600000)await rm(file,{force:true});
      }
    }
  } catch {return null;}
  const path = key => {if(!/^[a-f0-9]{64}$/u.test(key))throw Error("invalid-artifact-key");return join(root, `${key}.gz`);};
  return {
    async read(key) {
      let file;
      try {
        file = await open(path(key), constants.O_RDONLY | (constants.O_NOFOLLOW??0) | (constants.O_NONBLOCK??0));
        const meta=await file.stat();if(!meta.isFile()||meta.size>MAX_ENTRY)return null;
        const envelope=JSON.parse(gunzipSync(await file.readFile(), {maxOutputLength:MAX_DECODED}));
        if(envelope.schema!==1||envelope.key!==key||typeof envelope.payload!=="string"||digest(envelope.payload)!==envelope.digest)return null;
        return JSON.parse(envelope.payload);
      } catch {return null;} finally {await file?.close();}
    },
    async write(key, value) {
      let temporary;
      try {
        const payload=JSON.stringify(value);if(Buffer.byteLength(payload)>MAX_DECODED/2)return false;
        const bytes=gzipSync(JSON.stringify({schema:1,key,digest:digest(payload),payload}));if(bytes.length>MAX_ENTRY)return false;
        temporary=join(root, `.write-${randomUUID()}`);
        const file=await open(temporary,"wx",0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
        await rename(temporary,path(key));temporary=null;
        const entries=[];for(const name of await readdir(root))if(/^[a-f0-9]{64}\.gz$/u.test(name)){const info=await lstat(join(root,name)).catch(()=>null);if(info?.isFile())entries.push({name,size:info.size,mtime:info.mtimeMs});}
        let total=entries.reduce((sum,e)=>sum+e.size,0),count=entries.length;
        for(const entry of entries.sort((a,b)=>a.mtime-b.mtime)) {
          if(count<=MAX_ENTRIES&&total<=MAX_TOTAL)break;
          if(entry.name===`${key}.gz`)continue;
          await rm(join(root,entry.name),{force:true});count--;total-=entry.size;
        }
        return true;
      } catch {return false;} finally {if(temporary)await rm(temporary,{force:true}).catch(()=>{});}
    }
  };
}
