import {test} from 'node:test';import assert from 'node:assert/strict';import{moduleGraph}from'../server-programs/android-module-graph.mjs';
test('dependency visibility and reverse reference scopes remain distinct',()=>{
 const graph=moduleGraph([{module:':core'},{module:':common',projectDependencies:[{module:':core'}]},{module:':app',projectDependencies:[{module:':common'}]},{module:':second',projectDependencies:[{module:':core'}]}]);
 assert.equal(graph.canReference(':app',':core'),true);assert.equal(graph.canReference(':core',':app'),false);
 assert.deepEqual(graph.referenceRoots(':core'),[':app',':second']);assert.deepEqual(graph.consumers(':common'),[':common',':app']);
 assert.deepEqual(graph.closure(':common').map(item=>item.module),[':common',':core']);
});
test('missing, duplicate and cyclic modules fail instead of claiming an empty reference search',()=>{
 assert.throws(()=>moduleGraph([{module:':a',projectDependencies:[{module:':b'}]}]),/dependency-missing/u);
 assert.throws(()=>moduleGraph([{module:':a'},{module:':a'}]),/duplicate/u);
 assert.throws(()=>moduleGraph([{module:':a',projectDependencies:[{module:':b'}]},{module:':b',projectDependencies:[{module:':a'}]}]),/cycle/u);
});
