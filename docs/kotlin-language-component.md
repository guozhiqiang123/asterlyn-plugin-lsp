# Kotlin language component 2.3.21 builder

This builder is development-only and does not publish or install a component.
It creates the component identity `kotlin-language-server-asterlyn` version
`1.3.13-asterlyn.2.3.21.2`; it never claims to be the upstream fwcd
`kotlin-language-server` 1.3.13 distribution.

The source input is pinned to fwcd commit
`6d9e61b79d4631e75516def7ab7ff0d8b9310467`. A final Kotlin 2.3.21 source patch
and a dependency receipt are required. The receipt pins the source archive SHA,
each Maven dependency's basename/coordinate/official Maven URL/raw SHA, and
the SHA of the pinned upstream omnibus license report. It separately pins the
exact runtime JAR set emitted by `installDist`, including each raw JAR SHA and
the same report's license SHA. The
builder rejects a different commit, an unlisted or extra runtime JAR, a changed
runtime JAR, a patch digest mismatch, a missing/changed license, or a stale
`installDist` output. It archives the pinned commit into a fresh temporary tree,
applies the patch, and runs:

```text
./gradlew --offline --no-daemon --rerun-tasks :server:installDist
```

The Gradle user home must be supplied explicitly and is never created from a
project-selected path. The output is normalized into this fixed layout:

```text
server/lib/asterlyn-kotlin-server.jar
server/lib/shared-asterlyn.jar
server/lib/<other verified runtime jars>.jar
licenses/kotlin-language-server-MIT.txt
licenses/dependency-*.txt
NOTICE.json
```

JAR entries preserve their original stored/deflated content mode while using
fixed timestamps and sorted names; component archive entries also use fixed
timestamps and sorted names. This keeps all runtime JAR content and signatures
present while making the wrapper deterministic.
`NOTICE.json` records the source repository/commit, patch digest, every receipt
dependency URL/coordinate/SHA, every produced runtime JAR digest, and all
license file names. No development-machine absolute paths are written to the
archive.

The final worker patch used for the reproducible proof is
`/tmp/asterlyn-android-lsp/kotlin-2.3.21-proof/fwcd-2.3.21-pull-final.patch`
(SHA-256 `0d90050f1145296aaa8b01e44fca07357f690d915e167baf6de200c92e868931`).
The pinned source archive is SHA-256
`9b92b4cfe5a073ce16366ad3c986ec2ed7983c5db0837561a8106ba0cd74f149`.

Example with the proof receipt:

```sh
python3 scripts/build-kotlin-language-component.py \
  --source /tmp/kls-component-2.3.21-proof/fwcd-source \
  --patch /tmp/asterlyn-android-lsp/kotlin-2.3.21-proof/fwcd-2.3.21-pull-final.patch \
  --receipt /tmp/kls-component-2.3.21-proof/receipt-pull-final/dependencies.json \
  --jdk /Users/gzq/Library/Java/JavaVirtualMachines/jbr-17.0.14/Contents/Home \
  --gradle-home /tmp/kls-component-2.3.21-proof/gradle-home \
  --output /tmp/kls-component-2.3.21-proof/kotlin-language-server-asterlyn.tar.gz
```

The builder intentionally cannot complete against the earlier proof's old
`server-1.3.14.jar` alone: that would not prove a clean source-plus-patch
rebuild. Two local clean runs using this patch and receipt produced the
identical output archive with the new `.2` component identity and 39 runtime
JARs. The patch includes versioned `kotlin/asterlynDocumentDiagnostics` pull
responses (URI/version/digest) and lazy per-file compiled epochs: initial
registration is O(N), while `put` no longer clears/reparses the full PSI cache.
The runs use JDK 17 and a dedicated Gradle home containing
controlled dependency caches and wrapper distributions; no user
`gradle.properties`, init scripts, credentials, or proxy settings were copied.
This is development evidence only; host component admission and mixed-language
acceptance remain separate gates.

Receipt negative checks are part of the builder gate: replacing a runtime
basename, changing a runtime byte, omitting a runtime entry, changing a Maven
URL/coordinate, or changing a license file aborts before archive creation.


## 2026-10-30 incremental/reference component .3

`1.3.13-asterlyn.2.3.21.3` adds `kotlin/asterlynReferences` over exact source declaration locations.
Java candidates are confirmed using compiler descriptors and PSI declaration name ranges; operator
calls use resolved call descriptors. New workspace files remain workspace sources, fixing upstream
watch-created files being hidden as temporary sources. The pinned commit and 39 runtime JARs are
unchanged; the committed dependency lock now binds the new patch digest.

Build archive SHA-256: `b116ba91ee10f3e3be08781e4f08fe3c3ae5432ced42a80fb03b5cacf29e7634`.
Admitted inventory digest: `46ea863b9182505825b3ddfd343b12693a77a3a996fd7b740cd560ae6e6a798c`.
This remains an explicitly installed component; activation does not download tools.
