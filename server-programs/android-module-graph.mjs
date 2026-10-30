export function moduleGraph(modules) {
 const byId=new Map(modules.map(module=>[module.module,module]));if(byId.size!==modules.length)throw Error("android-module-duplicate");
 const closures=new Map(),visiting=new Set();
 const closure=id=>{
  if(closures.has(id))return closures.get(id);if(visiting.has(id))throw Error("android-module-cycle");
  const module=byId.get(id);if(!module)throw Error("android-module-dependency-missing");visiting.add(id);
  const result=[...new Set([id,...(module.projectDependencies??[]).flatMap(dep=>closure(dep.module??dep))])];
  visiting.delete(id);closures.set(id,result);return result;
 };
 for(const id of byId.keys())closure(id);
 const consumers=id=>[...byId.keys()].filter(candidate=>closure(candidate).includes(id));
 // A root source view already contains its dependency closure. Do not start one JVM per module.
 const referenceRoots=id=>{const ids=consumers(id);return ids.filter(candidate=>!ids.some(other=>other!==candidate&&closure(other).includes(candidate)));};
 return {closure:id=>closure(id).map(id=>byId.get(id)),consumers,referenceRoots,canReference:(from,to)=>closures.get(from)?.includes(to)??false};
}
