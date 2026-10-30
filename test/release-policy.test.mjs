import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {verifyReleasePolicy,verifyPublishedSdk} from '../scripts/verify-release-policy.mjs';
const json=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8')),policy=json('release-policy.json'),pkg=json('package.json'),lock=json('package-lock.json'),manifest=json('manifest.json');
test('release identity and independent SDK provenance are mandatory',()=>{
 assert.doesNotThrow(()=>verifyReleasePolicy(policy,pkg,lock,manifest,policy.host.sdkSha256,`v${pkg.version}`));
 assert.throws(()=>verifyReleasePolicy(policy,pkg,lock,manifest,'0'.repeat(64)));assert.throws(()=>verifyReleasePolicy(policy,pkg,lock,manifest,policy.host.sdkSha256,'v9.9.9'));
 const wrong=structuredClone(manifest);wrong.distribution.hostCompatibility.minimum='0.1.20';assert.throws(()=>verifyReleasePolicy(policy,pkg,lock,wrong,policy.host.sdkSha256));
});
test('development bytes, draft and prerelease metadata cannot impersonate a published SDK',()=>{
 const release={tagName:policy.host.tag,isDraft:false,isPrerelease:false};assert.doesNotThrow(()=>verifyPublishedSdk(policy,release,policy.host.sdkSha256));
 for(const patch of [{isDraft:undefined},{isPrerelease:undefined},{isDraft:true},{isPrerelease:true},{tagName:'v0.1.20'}])assert.throws(()=>verifyPublishedSdk(policy,{...release,...patch},policy.host.sdkSha256));assert.throws(()=>verifyPublishedSdk(policy,release,'0'.repeat(64)));
});
