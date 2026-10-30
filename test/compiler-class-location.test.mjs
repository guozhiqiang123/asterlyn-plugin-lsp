import test from "node:test";import assert from "node:assert/strict";
import {compilerClassLocations} from "../server-programs/compiler-class-location.mjs";
test("class location requires a compiler identity and anchored declaration, handles nested names and Unicode offsets",()=>{
 const text="// 😀\nobject GlobalConfigNew : Base() {}\nclass Other {}",uri="file:///root/Foo.kt",offset=text.indexOf("object");
 const entries=[{key:"pkg/GlobalConfigNew",offset},{key:"pkg/GlobalConfigNew#<init>()V",offset},{key:"pkg/Wrong",offset},{key:"pkg/GlobalConfigNew",offset:0}];
 assert.deepEqual(compilerClassLocations(entries,text,uri),[{uri,range:{start:{line:1,character:7},end:{line:1,character:22}}}]);
 assert.equal(compilerClassLocations([{key:"pkg/Outer$Inner",offset:0}],"class Inner {}",uri).length,1);
 assert.deepEqual(compilerClassLocations([{key:"pkg/GlobalConfigNew",offset:0}],"object GlobalConfigNew2 {}",uri),[]);
 assert.deepEqual(compilerClassLocations([],text,uri),[]);
});
