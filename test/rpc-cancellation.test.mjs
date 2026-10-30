import {test} from 'node:test';import assert from 'node:assert/strict';import{PassThrough}from'node:stream';import{RpcPeer}from'../server-programs/rpc.mjs';
test('cancelled RPC releases its slot, forwards cancel and ignores late replies',async()=>{
 const input=new PassThrough(),output=new PassThrough(),frames=[];output.on('data',data=>frames.push(data.toString()));
 const peer=new RpcPeer(input,output),abort=new AbortController(),request=peer.request('query',{},10000,abort.signal);
 abort.abort();await assert.rejects(request,error=>error.code===-32800);assert.ok(frames.join('').includes('$/cancelRequest'));
 const pending=peer.request('next',{},10000),body=JSON.stringify({jsonrpc:'2.0',id:1,result:'old'});input.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
 const current=JSON.stringify({jsonrpc:'2.0',id:2,result:'current'});input.write(`Content-Length: ${Buffer.byteLength(current)}\r\n\r\n${current}`);assert.equal(await pending,'current');peer.close();
});
test('pre-cancelled and closed RPCs cannot retain listeners or pending requests',async()=>{
 const input=new PassThrough(),output=new PassThrough(),peer=new RpcPeer(input,output),abort=new AbortController();abort.abort();
 await assert.rejects(peer.request('never-sent',{},10000,abort.signal),error=>error.code===-32800);
 const active=new AbortController(),pending=peer.request('pending',{},10000,active.signal);peer.close();await assert.rejects(pending,/peer-closed/u);active.abort();
});
