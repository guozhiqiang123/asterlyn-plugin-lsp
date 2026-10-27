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
