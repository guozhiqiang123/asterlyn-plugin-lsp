#!/usr/bin/env python3
"""Build the optional, reproducible compiler component from fixed public Maven artifacts."""
from pathlib import Path
import argparse,json,hashlib,tarfile,gzip,io
p=argparse.ArgumentParser();p.add_argument('--receipt',required=True);p.add_argument('--output',required=True);a=p.parse_args()
receipt=json.loads(Path(a.receipt).read_text());files={};sources={}
expected={'compilerJar':('kotlin-compiler-embeddable-2.2.0.jar','b2f743ea5ba12f69e0f35e5d8d46069d74c8e2861087548a7e0e14a784bc4cf1'),'kaptJar':('kotlin-annotation-processing-embeddable-2.2.0.jar','6532b19ce226a164715121ada86e381c79a7c2a0c8a66311368f545e4af176ea')}
for key,(name,sha) in expected.items():
 entry=receipt['components'][key];data=Path(entry['path']).read_bytes()
 if hashlib.sha256(data).hexdigest()!=sha:raise SystemExit('Kotlin component checksum mismatch')
 files[name]=data;sources[name]={'coordinate':entry['coordinate'],'sha256':sha}
license_file=Path(__file__).resolve().parent.parent/'servers/typescript/typescript/LICENSE.txt'
license_text=license_file.read_text();files['LICENSE-Apache-2.0.txt']=license_text[:license_text.index('END OF TERMS AND CONDITIONS')+len('END OF TERMS AND CONDITIONS')].encode()
files['NOTICE.json']=json.dumps({'license':'Apache-2.0','attribution':'JetBrains s.r.o. and Kotlin contributors','artifacts':sources,'sourceMirrors':receipt['sourceMirrors']},sort_keys=True,indent=2).encode()
archive=Path(a.output);archive.parent.mkdir(parents=True,exist_ok=True)
with archive.open('wb') as raw,gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as t:
 for name,data in sorted(files.items()):
  info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o444;info.mtime=1577836800;t.addfile(info,io.BytesIO(data))
print(json.dumps({'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size}))
