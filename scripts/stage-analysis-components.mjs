import {readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {stageComponents} from './component-staging.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const expected=manifest.languageServers.flatMap(s=>s.program.components),args=process.argv.slice(2),input=new Map(args.map(value=>{const at=value.indexOf('=');if(at<1)throw Error('Use component-id=/absolute/archive.tar.gz');return[value.slice(0,at),resolve(value.slice(at+1))];}));
if(args.length!==expected.length)throw Error('Supply each declared component exactly once');
const summary=await stageComponents(expected,input,join(root,'release-components'));console.log(JSON.stringify({staged:summary.map(c=>({id:c.id,bytes:c.bytes})),hashesVerified:true}));
