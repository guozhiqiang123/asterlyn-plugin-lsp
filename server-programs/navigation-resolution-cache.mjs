/** Single-use definition handoff, scoped by the adapter's exact analysis revision. */
export function navigationResolutionCache({now=()=>performance.now(),ttlMs=2000,maxEntries=16,maxBytes=256*1024}={}) {
  const entries=new Map();let bytes=0;
  const remove=key=>{const value=entries.get(key);if(value){entries.delete(key);bytes-=value.bytes;}return value;};
  return {
    put(key,value){
      remove(key);const json=JSON.stringify(value);if(json===undefined)return;
      const size=Buffer.byteLength(json);if(size>maxBytes)return;
      for(const [old,item]of entries)if(now()-item.at>ttlMs)remove(old);
      while(entries.size>=maxEntries||bytes+size>maxBytes)remove(entries.keys().next().value);
      entries.set(key,{json,bytes:size,at:now()});bytes+=size;
    },
    take(key){const value=remove(key);return value&&now()-value.at<=ttlMs?{value:JSON.parse(value.json)}:null;},
    clear(){entries.clear();bytes=0;}
  };
}
