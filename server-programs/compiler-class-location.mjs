/** Compiler metadata supplies the class identity and declaration start; text only maps its name range. */
export function compilerClassLocations(entries,text,uri) {
  const found=new Map();
  for(const {key,offset}of entries) {
    if(key.includes("#")||!Number.isSafeInteger(offset)||offset<0||offset>text.length)continue;
    const name=key.split(/[/$]/u).at(-1);if(!name||!/^[$\p{L}_][$\p{L}\p{N}_]*$/u.test(name))continue;
    const prefix=/^(?:(?:data|enum|annotation|sealed|value|open|abstract|final)\s+)*(?:class|object|interface)[ \t]+/u.exec(text.slice(offset));if(!prefix)continue;
    const start=offset+prefix[0].length,end=start+name.length;
    if(text.slice(start,end)!==name||/[$\p{L}\p{N}_]/u.test(text[end]??""))continue;
    const before=text.slice(0,start),line=before.split("\n").length-1,character=before.length-before.lastIndexOf("\n")-1;
    found.set(start,{uri,range:{start:{line,character},end:{line,character:character+name.length}}});
  }
  return [...found.values()];
}
