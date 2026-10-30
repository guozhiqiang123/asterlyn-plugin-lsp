import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import {resolve,join} from 'node:path';
export function verifyReleasePolicy(policy,pkg,lock,manifest,vendorDigest,tag=''){
 if(policy.schemaVersion!==1||policy.repository!==manifest.distribution.repository)throw Error('Release repository identity mismatch');
 if(pkg.version!==manifest.version||pkg.version!==lock.version||pkg.version!==lock.packages[''].version||!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pkg.version)||(tag&&tag!==`v${pkg.version}`))throw Error('Release version/tag mismatch');
 if(policy.host.tag!==`v${policy.host.version}`||manifest.distribution.hostCompatibility.minimum!==policy.host.version)throw Error('Host baseline mismatch');
 if(pkg.dependencies['@asterlyn/plugin-sdk']!==`file:vendor/${policy.host.sdkAsset}`||vendorDigest!==policy.host.sdkSha256)throw Error('Vendored SDK provenance mismatch');
 if(policy.dependency.tag!==`v${manifest.dependencies[0].minimum}`)throw Error('Required plugin Release mismatch');
}
export function verifyPublishedSdk(policy,release,digest){if(release.tagName!==policy.host.tag||release.isDraft||release.isPrerelease||digest!==policy.host.sdkSha256)throw Error('SDK must match the exact published stable host Release');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url)),json=async p=>JSON.parse(await readFile(join(root,p),'utf8'));
 const [policy,pkg,lock,manifest]=await Promise.all(['release-policy.json','package.json','package-lock.json','manifest.json'].map(json));
 const digest=b=>createHash('sha256').update(b).digest('hex');
 verifyReleasePolicy(policy,pkg,lock,manifest,digest(await readFile(join(root,'vendor',policy.host.sdkAsset))),process.argv[2]??'');
 if(process.argv[3])verifyPublishedSdk(policy,JSON.parse(await readFile(process.argv[4],'utf8')),digest(await readFile(process.argv[3])));
 console.log(JSON.stringify({version:pkg.version,hostRelease:policy.host.tag,sdk:policy.host.sdkVersion,publishedSdkVerified:!!process.argv[3]}));
}
