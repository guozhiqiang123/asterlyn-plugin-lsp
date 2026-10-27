#!/usr/bin/env python3
"""Rebuild and package the pinned Kotlin language-server fork offline.

Inputs are deliberately explicit: a clean checkout at the pinned commit, the
final source patch, a verified dependency receipt, a JDK and an isolated
GRADLE_USER_HOME. The builder always archives the commit into a fresh scratch
tree and runs Gradle with --offline --rerun-tasks, so an existing installDist
directory or old jar can never be accepted as a rebuild.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
import gzip
import re

PINNED_COMMIT = "6d9e61b79d4631e75516def7ab7ff0d8b9310467"
SERVER_JAR = "server-1.3.14.jar"
SHARED_JAR = "shared-1.3.14.jar"


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(args, *, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def safe_extract(source, destination):
    with tarfile.open(source) as archive:
        for member in archive.getmembers():
            relative = PurePosixPath(member.name)
            if relative.is_absolute() or ".." in relative.parts or not (member.isfile() or member.isdir()):
                raise SystemExit(f"unsafe source archive entry: {member.name}")
        archive.extractall(destination)


def normalize_jar(source, target):
    """Rewrite a JAR with fixed timestamps, order and permissions."""
    with zipfile.ZipFile(source) as source_zip, zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=False) as target_zip:
        for entry in sorted(source_zip.infolist(), key=lambda value: value.filename):
            if entry.filename.startswith("/") or ".." in PurePosixPath(entry.filename).parts:
                raise SystemExit(f"unsafe JAR entry: {entry.filename}")
            info = zipfile.ZipInfo(entry.filename, (2020, 1, 1, 0, 0, 0))
            info.compress_type = entry.compress_type if entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) else zipfile.ZIP_DEFLATED
            info.external_attr = 0o100444 << 16
            target_zip.writestr(info, source_zip.read(entry.filename))


def copy_license(path, destination):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise SystemExit(f"license file unavailable: {path}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, destination)
    destination.chmod(0o444)


def valid_relative(value):
    path = PurePosixPath(value)
    return bool(value) and not path.is_absolute() and ".." not in path.parts and "\\" not in value


def maven_url(coordinate, basename):
    parts = coordinate.split(":")
    if len(parts) not in (3, 4) or not all(parts):
        raise SystemExit(f"invalid Maven coordinate: {coordinate}")
    group, artifact, version = parts[:3]
    classifier = parts[3] if len(parts) == 4 else None
    expected = f"{artifact}-{version}{('-' + classifier) if classifier else ''}.jar"
    if basename != expected or not re.fullmatch(r"[A-Za-z0-9._+-]+\.jar", basename):
        raise SystemExit(f"runtime basename does not match coordinate: {coordinate}")
    return f"https://repo1.maven.org/maven2/{group.replace('.', '/')}/{artifact}/{version}/{basename}"


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True, help="clean pinned fwcd checkout")
parser.add_argument("--patch", required=True, help="final Kotlin 2.3.21 source patch")
parser.add_argument("--receipt", required=True, help="fixed dependency receipt")
parser.add_argument("--jdk", required=True)
parser.add_argument("--gradle-home", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--work-dir", default="/tmp/kls-component-2.3.21-proof")
args = parser.parse_args()

source = Path(args.source).resolve()
patch = Path(args.patch).resolve()
receipt_path = Path(args.receipt).resolve()
jdk = Path(args.jdk).resolve()
gradle_home = Path(args.gradle_home).resolve()
if not (source.is_dir() and patch.is_file() and receipt_path.is_file() and (jdk / "bin/java").is_file() and gradle_home.is_dir()):
    raise SystemExit("source, patch, receipt, JDK and isolated Gradle home are required")

receipt = json.loads(receipt_path.read_text())
if receipt.get("schema") != 1 or receipt.get("sourceCommit") != PINNED_COMMIT or receipt.get("sourceRepository") != "https://github.com/fwcd/kotlin-language-server":
    raise SystemExit("dependency receipt is not bound to the pinned source commit")
actual_commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
if actual_commit != PINNED_COMMIT:
    raise SystemExit(f"unexpected source commit: {actual_commit}")
patch_digest = sha256(patch)
if not re.fullmatch(r"[0-9a-f]{64}", str(receipt.get("patchSha256", ""))) or receipt["patchSha256"] != patch_digest:
    raise SystemExit("source patch checksum does not match receipt")
if not re.fullmatch(r"[0-9a-f]{64}", str(receipt.get("sourceArchiveSha256", ""))):
    raise SystemExit("source archive checksum is required")
source_license = receipt.get("sourceLicensePath")
if not valid_relative(source_license) or not re.fullmatch(r"[0-9a-f]{64}", str(receipt.get("sourceLicenseSha256", ""))):
    raise SystemExit("source license path/checksum is required")

dependencies = receipt.get("dependencies")
if not isinstance(dependencies, list) or not dependencies:
    raise SystemExit("dependency receipt must contain a non-empty fixed dependency set")
dependency_coordinates = set()
dependency_basenames = set()
for dependency in dependencies:
    if not isinstance(dependency, dict) or not dependency.get("coordinate") or not dependency.get("url"):
        raise SystemExit("invalid dependency receipt entry")
    if not dependency["url"].startswith("https://") or not isinstance(dependency.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", dependency["sha256"]):
        raise SystemExit(f"invalid dependency URL/checksum: {dependency.get('coordinate')}")
    path = Path(dependency.get("path", ""))
    if not path.is_file() or sha256(path) != dependency.get("sha256"):
        raise SystemExit(f"dependency checksum mismatch: {dependency.get('coordinate')}")
    if not dependency.get("licensePath"):
        raise SystemExit(f"dependency license missing: {dependency.get('coordinate')}")
    if not re.fullmatch(r"[0-9a-f]{64}", str(dependency.get("licenseSha256", ""))):
        raise SystemExit(f"dependency license checksum missing: {dependency.get('coordinate')}")
    if dependency["url"] != maven_url(dependency["coordinate"], dependency["basename"]):
        raise SystemExit(f"dependency URL does not match coordinate: {dependency['coordinate']}")
    if dependency["coordinate"] in dependency_coordinates or dependency["basename"] in dependency_basenames:
        raise SystemExit("dependency coordinate or basename is duplicated")
    dependency_coordinates.add(dependency["coordinate"])
    dependency_basenames.add(dependency["basename"])

runtime_libraries = receipt.get("runtimeLibraries")
if not isinstance(runtime_libraries, list) or not runtime_libraries:
    raise SystemExit("runtimeLibraries receipt is required")
runtime_by_name = {}
runtime_coordinates = set()
for runtime in runtime_libraries:
    if not isinstance(runtime, dict) or not valid_relative(runtime.get("basename", "")) or "/" in runtime["basename"] or not runtime.get("coordinate"):
        raise SystemExit("invalid runtime library basename")
    if runtime["basename"] in {SERVER_JAR, SHARED_JAR} or runtime["basename"] in runtime_by_name or runtime.get("coordinate") in runtime_coordinates:
        raise SystemExit("runtime library basename is reserved or duplicated")
    if not re.fullmatch(r"[0-9a-f]{64}", str(runtime.get("sha256", ""))):
        raise SystemExit(f"runtime checksum missing: {runtime.get('basename')}")
    if runtime.get("url") != maven_url(runtime["coordinate"], runtime["basename"]):
        raise SystemExit(f"runtime URL does not match coordinate: {runtime.get('coordinate')}")
    if not runtime.get("licensePath") or not re.fullmatch(r"[0-9a-f]{64}", str(runtime.get("licenseSha256", ""))):
        raise SystemExit(f"runtime license checksum missing: {runtime.get('basename')}")
    runtime_by_name[runtime["basename"]] = runtime
    runtime_coordinates.add(runtime["coordinate"])

work = Path(args.work_dir).resolve()
work.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="build-", dir=work) as temporary:
    temporary = Path(temporary)
    source_tar = temporary / "source.tar"
    clean = temporary / "source"
    run(["git", "-C", str(source), "archive", "--format=tar", PINNED_COMMIT, "-o", str(source_tar)])
    if sha256(source_tar) != receipt["sourceArchiveSha256"]:
        raise SystemExit("pinned source archive checksum mismatch")
    clean.mkdir()
    safe_extract(source_tar, clean)
    run(["patch", "--batch", "--forward", "-p1", "-i", str(patch)], cwd=clean)
    wrapper = clean / "gradlew"
    if not wrapper.is_file() or wrapper.is_symlink():
        raise SystemExit("pinned source has no safe Gradle wrapper")
    build_tmp = temporary / "tmp"
    build_home = temporary / "home"
    build_tmp.mkdir()
    build_home.mkdir()
    build_env = {
        "HOME": str(build_home),
        "JAVA_HOME": str(jdk),
        "GRADLE_USER_HOME": str(gradle_home),
        "TMPDIR": str(build_tmp),
        "PATH": f"{jdk / 'bin'}:/usr/bin:/bin",
        "LANG": "C",
        "LC_ALL": "C",
    }
    run([str(wrapper), "--offline", "--no-daemon", "--rerun-tasks", ":server:installDist"], cwd=clean, env=build_env)
    distribution = clean / "server" / "build" / "install" / "server"
    lib = distribution / "lib"
    server = lib / SERVER_JAR
    shared = lib / SHARED_JAR
    if not (server.is_file() and shared.is_file()):
        raise SystemExit("fresh installDist did not produce the pinned server/shared jars")
    actual_runtime_names = {jar.name for jar in lib.glob("*.jar")} - {SERVER_JAR, SHARED_JAR}
    if actual_runtime_names != set(runtime_by_name):
        missing = sorted(set(runtime_by_name) - actual_runtime_names)
        extra = sorted(actual_runtime_names - set(runtime_by_name))
        raise SystemExit(f"fresh runtime set differs from receipt; missing={missing}, extra={extra}")
    for name, expected in runtime_by_name.items():
        if sha256(lib / name) != expected["sha256"]:
            raise SystemExit(f"fresh runtime checksum differs from receipt: {name}")

    staging = temporary / "component" / "server" / "lib"
    staging.mkdir(parents=True)
    runtime = []
    for jar in sorted(lib.glob("*.jar")):
        output_name = "asterlyn-kotlin-server.jar" if jar.name == SERVER_JAR else "shared-asterlyn.jar" if jar.name == SHARED_JAR else jar.name
        target = staging / output_name
        normalize_jar(jar, target)
        expected = runtime_by_name.get(jar.name, {})
        runtime.append({
            "path": f"server/lib/{output_name}",
            "basename": jar.name,
            "coordinate": expected.get("coordinate"),
            "url": expected.get("url"),
            "rawSha256": f"sha256:{sha256(jar)}",
            "bytes": target.stat().st_size,
            "sha256": f"sha256:{sha256(target)}",
        })

    licenses = temporary / "component" / "licenses"
    copy_license(clean / source_license, licenses / "kotlin-language-server-MIT.txt")
    if sha256(clean / source_license) != receipt["sourceLicenseSha256"]:
        raise SystemExit("source license checksum differs from receipt")
    license_entries = ["kotlin-language-server-MIT.txt"]
    for index, runtime_entry in enumerate(runtime_libraries):
        name = "runtime-%03d-%s.txt" % (index, runtime_entry["coordinate"].replace(":", "-").replace("/", "-"))
        copy_license(runtime_entry["licensePath"], licenses / name)
        if sha256(runtime_entry["licensePath"]) != runtime_entry["licenseSha256"]:
            raise SystemExit(f"runtime license checksum differs from receipt: {runtime_entry['basename']}")
        license_entries.append(name)
    for index, dependency in enumerate(dependencies):
        name = "dependency-%03d-%s.txt" % (index, dependency["coordinate"].replace(":", "-").replace("/", "-"))
        copy_license(dependency["licensePath"], licenses / name)
        if sha256(dependency["licensePath"]) != dependency["licenseSha256"]:
            raise SystemExit(f"dependency license checksum differs from receipt: {dependency['coordinate']}")
        license_entries.append(name)

    notice = {
        "schema": 1,
        "componentId": "kotlin-language-server-asterlyn",
        "componentVersion": "1.3.13-asterlyn.2.3.21.2",
        "source": {"repository": receipt.get("sourceRepository"), "commit": PINNED_COMMIT, "patchSha256": patch_digest},
        "dependencies": [{key: value for key, value in dependency.items() if key not in {"path", "licensePath"}} for dependency in dependencies],
        "runtimeJars": runtime,
        "licenses": license_entries,
    }
    component_root = temporary / "component"
    (component_root / "NOTICE.json").write_text(json.dumps(notice, sort_keys=True, indent=2) + "\n")
    (component_root / "NOTICE.json").chmod(0o444)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as gz, tarfile.open(fileobj=gz, mode="w") as archive:
        for path in sorted((entry for entry in component_root.rglob("*") if entry.is_file()), key=lambda value: value.relative_to(component_root).as_posix()):
            relative = path.relative_to(component_root).as_posix()
            info = tarfile.TarInfo(relative)
            info.size = path.stat().st_size
            info.mode = 0o444
            info.mtime = 1577836800
            archive.addfile(info, io.BytesIO(path.read_bytes()))
    print(json.dumps({"archive": str(output), "sha256": sha256(output), "bytes": output.stat().st_size, "runtimeJars": len(runtime)}, sort_keys=True))
