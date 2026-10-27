#!/usr/bin/env python3
"""Build a reproducible, receipt-pinned Kotlin compiler/KAPT component.

The receipt is prepared after downloading exact public Maven artifacts over TLS.
This script never downloads or resolves dependencies. Kotlin 2.2.0 remains
supported for reproducing the existing component; 2.3.21 additionally packages
its explicit runtime dependency set.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import io
import json
import tarfile

SUPPORTED = {
    "2.2.0": {
        "compilerJar": ("kotlin-compiler-embeddable-2.2.0.jar", "org.jetbrains.kotlin:kotlin-compiler-embeddable:2.2.0", "b2f743ea5ba12f69e0f35e5d8d46069d74c8e2861087548a7e0e14a784bc4cf1"),
        "kaptJar": ("kotlin-annotation-processing-embeddable-2.2.0.jar", "org.jetbrains.kotlin:kotlin-annotation-processing-embeddable:2.2.0", "6532b19ce226a164715121ada86e381c79a7c2a0c8a66311368f545e4af176ea"),
    },
    "2.3.21": {
        "compilerJar": ("kotlin-compiler-embeddable-2.3.21.jar", "org.jetbrains.kotlin:kotlin-compiler-embeddable:2.3.21", "d3e70fb011675e77ef00f1a68918d3cd91eed26058977d1e3ea2a37a293233af"),
        "kaptJar": ("kotlin-annotation-processing-embeddable-2.3.21.jar", "org.jetbrains.kotlin:kotlin-annotation-processing-embeddable:2.3.21", "7e8e36c0a349d67244c41e43adb4c482fa18ce0db042306515540f6c9ac2d476"),
        "runtimeJars": {
            "stdlib": ("kotlin-stdlib-2.3.21.jar", "org.jetbrains.kotlin:kotlin-stdlib:2.3.21", "6f64eac736db9434dd6925b4a518b9d1d17177652320c37916cf9ba3ce7d7d7a"),
            "scriptRuntime": ("kotlin-script-runtime-2.3.21.jar", "org.jetbrains.kotlin:kotlin-script-runtime:2.3.21", "ec61bf1229c837fa9f4255f34ca69816138b73158e7ae9b8d964cf92ca6dfd2e"),
            "reflect": ("kotlin-reflect-1.6.10.jar", "org.jetbrains.kotlin:kotlin-reflect:1.6.10", "3277ac102ae17aad10a55abec75ff5696c8d109790396434b496e75087854203"),
            "daemon": ("kotlin-daemon-embeddable-2.3.21.jar", "org.jetbrains.kotlin:kotlin-daemon-embeddable:2.3.21", "222fc10a3c22e74d30369bf8a0ca6c4f9372eac7d4a0081e290c256fa4d30fb2"),
            "coroutines": ("kotlinx-coroutines-core-jvm-1.8.0.jar", "org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.8.0", "9860906a1937490bf5f3b06d2f0e10ef451e65b95b269f22daf68a3d1f5065c5"),
        },
    },
}


def read_artifact(entry, expected, key):
    if not isinstance(entry, dict):
        raise SystemExit(f"invalid receipt component: {key}")
    name, coordinate, checksum = expected
    if entry.get("coordinate") != coordinate or entry.get("sha256") != checksum:
        raise SystemExit(f"{key} receipt identity/checksum mismatch")
    path = Path(entry.get("path", ""))
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != checksum:
        raise SystemExit(f"{key} checksum mismatch")
    return name, data, {"coordinate": coordinate, "sha256": checksum}


parser = argparse.ArgumentParser()
parser.add_argument("--receipt", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--version", choices=sorted(SUPPORTED), default=None)
args = parser.parse_args()
receipt = json.loads(Path(args.receipt).read_text())
if receipt.get("schema") != 1 or not isinstance(receipt.get("components"), dict):
    raise SystemExit("invalid Kotlin component receipt")
components = receipt["components"]
version = args.version or components.get("compilerJar", {}).get("coordinate", "").rsplit(":", 1)[-1]
if version not in SUPPORTED:
    raise SystemExit(f"unsupported Kotlin compiler version: {version}")
expected = SUPPORTED[version]
files = {}
sources = {}
for key in ("compilerJar", "kaptJar"):
    name, data, source = read_artifact(components.get(key), expected[key], key)
    files[name] = data
    sources[name] = source

runtime_expected = expected.get("runtimeJars", {})
runtime_receipt = components.get("runtimeJars", {})
if runtime_expected:
    if set(runtime_receipt) != set(runtime_expected):
        raise SystemExit("Kotlin 2.3.21 runtime dependency set is incomplete or has extras")
    for key, requirement in runtime_expected.items():
        name, data, source = read_artifact(runtime_receipt[key], requirement, f"runtimeJars.{key}")
        files[name] = data
        sources[name] = source
elif runtime_receipt and version != "2.2.0":
    raise SystemExit("runtimeJars are not accepted for this Kotlin compatibility build")

license_file = Path(__file__).resolve().parent.parent / "servers/typescript/typescript/LICENSE.txt"
license_text = license_file.read_text()
if "END OF TERMS AND CONDITIONS" not in license_text:
    raise SystemExit("Apache license text is incomplete")
if version == "2.2.0":
    # Preserve the byte-exact legacy component already pinned by the Android
    # profile.  Newer components intentionally use the complete license and
    # expanded notice schema below.
    license_text = license_text[:license_text.index("END OF TERMS AND CONDITIONS") + len("END OF TERMS AND CONDITIONS")]
    notice = {
        "license": "Apache-2.0",
        "attribution": "JetBrains s.r.o. and Kotlin contributors",
        "artifacts": sources,
        "sourceMirrors": receipt["sourceMirrors"],
    }
else:
    notice = {
        "schema": 1,
        "license": "Apache-2.0",
        "attribution": "JetBrains s.r.o. and Kotlin contributors",
        "kotlinVersion": version,
        "artifacts": sources,
        "sourceMirrors": receipt.get("sourceMirrors", []),
        "runtimeDependencies": sorted(name for name in sources if name not in {
            f"kotlin-compiler-embeddable-{version}.jar",
            f"kotlin-annotation-processing-embeddable-{version}.jar",
        }),
    }
files["LICENSE-Apache-2.0.txt"] = license_text.encode()
files["NOTICE.json"] = json.dumps(notice, sort_keys=True, indent=2).encode()

archive = Path(args.output)
archive.parent.mkdir(parents=True, exist_ok=True)
with archive.open("wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as gz, tarfile.open(fileobj=gz, mode="w") as tar:
    for name, data in sorted(files.items()):
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mode = 0o444
        info.mtime = 1577836800
        tar.addfile(info, io.BytesIO(data))
print(json.dumps({"archive": str(archive), "version": version, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "bytes": archive.stat().st_size, "files": len(files)}, sort_keys=True))
