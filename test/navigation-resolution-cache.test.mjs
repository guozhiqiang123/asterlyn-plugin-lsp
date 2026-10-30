import test from "node:test";
import assert from "node:assert/strict";
import {navigationResolutionCache} from "../server-programs/navigation-resolution-cache.mjs";
test("definition handoff is single use, preserves empty/null and rejects expired or different revisions",()=>{
  let now=0;const cache=navigationResolutionCache({now:()=>now,ttlMs:10});
  cache.put("rev1",[]);assert.equal(cache.take("rev2"),null);assert.deepEqual(cache.take("rev1"),{value:[]});assert.equal(cache.take("rev1"),null);
  cache.put("null",null);assert.deepEqual(cache.take("null"),{value:null});cache.put("late",[]);now=11;assert.equal(cache.take("late"),null);
});
test("handoff has entry/byte bounds, does not retain caller mutations, and clears on model shutdown",()=>{
  const cache=navigationResolutionCache({maxEntries:2,maxBytes:40});const value=[{x:1}];cache.put("a",value);value[0].x=2;
  assert.deepEqual(cache.take("a").value,[{x:1}]);cache.put("a",[]);cache.put("b",[]);cache.put("c",[]);assert.equal(cache.take("a"),null);
  cache.put("huge","x".repeat(41));assert.equal(cache.take("huge"),null);cache.clear();assert.equal(cache.take("b"),null);
});
