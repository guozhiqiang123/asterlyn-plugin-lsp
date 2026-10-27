# Android Java / Kotlin MVP acceptance — 2026-10-27

## Delivered boundary

Host 0.1.22 / development SDK 1.14.0, Android Gradle plugin 0.6.0 and LSP plugin 0.3.0.
The descriptor only declares the fixed Android Java/Kotlin profile. Gradle/AGP and backend algorithms
live in the independent plugins; the host owns generic authority, workers, model leases and previews.
TS/JS/Rust remain separate profiles. LSP retains a hard dependency on the enabled Android plugin.

The Android plugin supplies an actual selected-variant AGP V2 module graph and classpaths. Java uses
a private Eclipse project per module. Kotlin uses each requested module's dependency closure, with
at most two lazy LRU language JVMs; an in-flight request prevents its session being evicted.
Dependency-source diagnostics are published only by their owning module's session. A common/library
module cannot resolve an app-only class. No symbol-name search or javap-generated declaration is used.

Java-to-Kotlin mapping uses the public Kotlin 2.2 KAPT stubs-only compiler and `.kapt_metadata`, plus
JDT's exact JVM declaration key. No annotation processor is loaded. Unsaved text stays in private
views and is never written to the user's project. Failed/old KAPT generations are cleaned; a syntax
error can temporarily make Java ABI-dependent results unavailable while Kotlin diagnostics remain usable.

## Functional evidence

`scripts/test-android-adapter.mjs` drives the actual packaged stdio adapter and reviewed standalone
JDT/Kotlin/compiler components against a separately assembled AGP 8.12.2 / Kotlin 2.2 / SDK 36
two-module, two-flavor Android fixture. It checks actual definition locations, nonempty hover and
completion, both directions of an unsaved method signature, current-version syntax diagnostics,
demo-to-prod model replacement retaining dirty buffers, and rejected reverse module dependencies.
The exact package is also extracted under a Chinese/space-containing directory and exercised there.
Android SDK Context source (364,618 bytes) is returned as a verified content-addressed readonly preview.
The native actor separately verifies that SDK result, nonblocking model work and versioned Java
diagnostics; Chromium/WebKit rendered Ctrl-click/F12/picker/readonly-keyboard tests cover presentation.

Initial isolated module-correct run: ready 7.867 s, total 34.903 s including edits, model replacement
and shutdown; owned-tree peak 1,405,808 KiB, shutdown 833 ms. Packaged-path run: ready 7.912 s,
total 34.639 s, peak 1,641,856 KiB, shutdown 832 ms. These are local fixture samples, not large-project
SLA/p95 claims. Cold first Java completion after a Kotlin ABI rebuild took about 4.4 s; warm requests
are measured separately. Two Kotlin JVMs are capped at 1,024 MiB heap each, JDT at 1,024 MiB; transient
compiler work is additional. No JVM starts merely from descriptor activation.

The 1,000-file metadata reader uses one bounded JVM and supports spaces/Chinese/emoji. Its reader
JAR SHA-256 is `47ffc03535752152fa1b6b74be6a2ca52f672d2085c8a4bc1a998b5fb3467b81`.
The version-bound diagnostics and URI parsing patch is reproducible from pinned fwcd source
`6d9e61b79d4631e75516def7ab7ff0d8b9310467`; final patched JAR SHA-256
`a9028fd6b3717303709dfe01e52eca450f5b6de5347ea626729d96a1e1314756`, 480,831 bytes.
The first-party JDT bridge is 7,734 bytes, SHA-256
`62d13b7401903bdfd03048ee4b9df8f9366e54c22fe8a78495da4e097e90e6d2`.

## Components / setup

Standalone published JDT LS 1.62.0 and fwcd Kotlin Language Server 1.3.13 are separately installed,
with complete readonly content receipts. Kotlin compiler/KAPT 2.2.0 is a reproducible four-file
component built by `scripts/package-kotlin-compiler-component.py` from pinned Maven binaries,
Apache-2.0 text and NOTICE. Exact component archive/content digests are frozen in `src/android-profile.ts`
and manifest, rather than ambient/project paths. JDT runs on a separate JDK 25; Gradle and Kotlin
use the admitted compatible JDK 17. Project wrapper/toolchain versions are unchanged.

## Explicit remaining limits

This is the Java/Kotlin Android core, not full Android Studio equivalence. Groovy, `.gradle`,
`.gradle.kts`, XML/resources, Compose, processor plugins, generated R/Binding/KSP and cross-module / cross-language
reference aggregation are not implemented. Existing generated sources can be imported; none are
implicitly built. Pure JVM dependencies and included/composite builds require a later model schema.
Readonly SDK/decompiled previews support selection/copy/keyboard navigation, not further semantic
queries or saving. Kotlin parser/compiler language features follow the reviewed fwcd 2.1 backend.

External edits to already catalogued source files are refreshed without overwriting open overlays;
new files are registered when opened. Discovery of new, unopened external files requires a model/
session refresh. Broader incremental watching, more than two simultaneously warm Kotlin modules,
full Java/Kotlin reference merging and large-project CPU/retained-memory soak tests remain follow-up.

Earlier boostCleaner Java/model probes succeeded before the user's dependency-cache cleanup. Those
old paths are no longer acceptance inputs. The new real Android fixture has persistent independent
caches. Re-populating boostCleaner dependencies encountered repository/proxy failures and is not
claimed as a fresh large-project pass. Import remains offline and never substitutes a different
artifact merely because its Maven coordinate/version matches. Sync/build the project through its
normal authorized workflow when dependencies are missing. No public Release or remote push occurs.

Structured logs, full request outcomes and package receipts are retained in
`/tmp/asterlyn-android-lsp`; source/classpath/credentials are not emitted to normal diagnostics.

Final packaged-path run: ready 8.215 s, whole test 35.483 s, owned-tree peak 1,373,248 KiB,
shutdown 820 ms. Twenty warm Java→Kotlin plus Kotlin→Java request pairs: p50 6 ms / p95 9 ms.
These measurements include exact declaration mapping and do not include a new Gradle import.
The metadata reader was built with Amazon Corretto Java 17.0.17 (`--release 17`).

Final crash-recovery package run also passes forced termination/restart of the owned Kotlin JVMs:
ready 8.217 s, complete test 41.899 s, peak 1,284,096 KiB, shutdown 827 ms, warm paired definitions
p50 8 ms / p95 19 ms. All observed child processes are checked stopped after shutdown.


## Real boostCleaner memory recovery (0.3.1)

The first full 25-module project probe reached readiness after 233,821 ms, then the app-module
Kotlin worker exhausted its 1 GiB heap. A thread dump and heap sample showed worker threads gone,
heap 1,046,859 / 1,048,576 KiB, but the JVM stayed alive. The Java definition/hover/completion case
passed; Kotlin was rejected after transport timeouts, so that artifact did not pass real-project
acceptance.

The Kotlin worker now has a fixed 2 GiB heap ceiling and `-XX:+ExitOnOutOfMemoryError`. At most two
lazy module-closure Kotlin workers remain allowed; this is a heap maximum, not an RSS guarantee or
up-front allocation. JDT retains its separate 1 GiB limit; transient compiler processes add memory.
Only the owning Kotlin backend exits on exhaustion, and its existing closed callback removes that
session entry so a later request can recreate it. A separate 32 MiB JVM OOM probe exited with code
3 rather than leaving a half-alive process.

With the 2 GiB configuration, the unchanged boostCleaner app source `AdsRuntimeState.kt` resolved
`SharedPref.getLong` into the real common module Java file in 1,823 ms; hover passed, total direct
Kotlin probe 4,843 ms, no OOM. Full packaged-adapter and installed acceptance are recorded in the
host [real-project recovery record](../../asterlyn/docs/engineering/2026-10-27-boostcleaner-lsp-recovery.md).

Package 0.3.1: 5,073,300 bytes, SHA-256
`7e849e7c6d745e11bc45e5bcb4ed21a952ad2f3165dd925e33e714289d84cd13`.
No server JAR or component receipt changed. Typecheck, 6 ordinary tests, package inspection and
native helper → desktop validation → TS/Rust/Android contribution routing pass.

`scripts/test-android-project.mjs` accepts an extracted package, verified model, reviewed component
options and local probe descriptions. It checks real definitions/hover/completion and unsaved
Java/Kotlin diagnostics, verifies source hashes remain unchanged, and records stages, timing and
process-tree RSS. It never saves overlay edits to the business project. Probe configurations and
raw local diagnostics are not committed.


### 0.3.2 scoped startup analysis

The 0.3.1 direct short probe did not establish long-running acceptance. The packaged adapter later
hit the 2 GiB ceiling too: upstream initialization scheduled `lintAll()` → `compileAllFiles()`,
resolving all closed-file bodies across the app's 25-module closure. That candidate was not installed
or published. Raising the heap alone is insufficient.

0.3.2 removes only initialization-time eager workspace lint from the pinned source patch. Source
catalog/discovery and cross-file semantic lookup remain; didOpen/didChange still lint open documents
with the previous text/version guards. Proactive closed-file diagnostics and full-workspace usage
indexing are not claimed. The updated JAR is 480,821 bytes, SHA-256
`26d0ec253d0bccb858f25ffb6603f2d42c9e8fbb94c850750194a036f86d53a8`.
Two independent patch rebuilds and root's third rebuild match. URI decoding and version capture
patches and the complete MIT license remain. A real boostCleaner probe waited 20 seconds idle,
then Kotlin→common Java definition took 47 ms, hover passed, no OOM (22,771 ms total).

Candidate 0.3.2: 5,074,033 bytes, SHA-256
`de28333692faf4767701ac1cc4613ec724e138234a6de30aaab87ebc7751ab0f`.
The final full packaged-project and installed gates remain in the host recovery record.
