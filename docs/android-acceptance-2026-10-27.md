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


## Large-project incremental recovery (0.3.4 candidate)

Earlier 0.3.1–0.3.3 bundles were local candidates, not installed acceptance. A larger heap alone
did not solve eager workspace compilation. The pinned fwcd patch now keeps source discovery and
Java-change binding invalidation, but defers closed-document body compilation until requested.
The reproducible patched JAR is 480,648 bytes, SHA-256
`4b18acbc4d719598f1163accc54d5097536679b94718d86445a06cc956c7faa3`.

Each Kotlin session seeds the captured open Java/Kotlin text into its private source view before
initialization, then opens versioned documents. Applying Java overlays after an initial Kotlin
didOpen used to dispose/recreate the compiler during that first lint and lose its diagnostic.
The diagnostic listener/cache is installed before those opens; reads require the exact current
private version, host version and Java context epoch. Pending overlay batches are drained before
analysis, and old snapshots are still rejected. Business sources are never overwritten.

KAPT records the actual effective-input digests. Opening an unchanged saved file therefore keeps
the existing Java ABI, while content changes invalidate it. Java navigation waits for current ABI
by returning the standard ContentModified response, rather than occupying a request until timeout.
While Kotlin ABI is rebuilding or temporarily invalid, the first-party JDT bridge returns only
current-working-copy syntax diagnostics; full type diagnostics refresh after the matching ABI is
committed. Syntax-only reports are explicitly accompanied by the partial-analysis status. This
is not a claim that type checking completed with stale Kotlin stubs.

The bridge is 7,859 bytes, SHA-256
`caa39507e93acf7b5c2567a6bf137e20a2ff6fcc9ddbe2771daed17cdddf4d6c`.
Its direct JDT regression checks syntax-vs-type categories, version/digest equality and rejection
of an incorrect digest. The real mixed fixture additionally covers saved-buffer reopen, Java
syntax feedback with an invalid Kotlin overlay, both unsaved signature directions, model refresh,
module visibility and owned Kotlin-process crash recovery. Final package and installed receipts
are recorded in the host recovery record after acceptance.

Candidate archive: 5,078,737 bytes, SHA-256
`9f8c14cd4bf9f8d581af2dc43e88fe400a543a0aa946dd6bb9398107c306c561`.
The exact extracted archive passes all 12 mixed-fixture checks including current syntax feedback
with invalid Kotlin (37 ms), saved-buffer reopen without ABI invalidation (45 ms), model replacement
and crash recovery. Under concurrent large-project import/native compilation, ready took 15.008 s,
whole regression 86.478 s, peak RSS 1,305,344 KiB, shutdown 890 ms. The earlier source-only run took
35.779 s; these local samples show machine-load sensitivity, not a p95/SLA claim.
Typecheck, six ordinary tests, archive inspection and native helper/desktop contribution routing pass.
Initial KAPT preparation still precedes JDT startup and can take minutes in large workspaces; the
responsive syntax path applies to later edits after backend readiness.

## Current-text Java syntax correction (0.3.5)

The stronger real-project test first pulls baseline diagnostics, then requires newly injected
unsaved errors to cover their inserted line. This exposed stale incremental `reconcile` parser
positions after semantic requests: a new error on line 21 was reported against the original class
on line 5. Syntax-only mode now creates a new JDT ASTParser over the captured working-copy text,
using the owning project's compiler options and no binding resolution. Full semantic diagnostics
retain the existing reconcile path. Digest/version/cancellation checks remain in force.

The independently rebuilt bridge is 8,274 bytes, SHA-256
`efbc2e3cd3bc835a08e17f6ce5410b9d46374e1ab220b303d5d87932781c67d0`.
Direct JDT baseline→edit/category/version/digest regression passes. The real common-module adapter
case has zero baseline diagnostics and reports all five new syntax errors on line 21 in 13 ms;
its Java definition/hover/completion also passes, business source hashes unchanged. Full 25-module
and final installed-package evidence follows in the host recovery record.


### 0.3.6 Kotlin 2.3 metadata and reliable diagnostic pull

The real project selects Kotlin stdlib 2.3.21, beyond the earlier compiler's metadata
reader. The publisher-owned source component now rebuilds pinned MIT fwcd source on
Kotlin 2.3.21 with its complete pinned runtime/license closure. It replaces the old
2.1 patched JAR instead of mixing compiler versions. Main project dependency versions,
TLS validation and global network configuration are unchanged. Standard-library
deserialized declarations get bounded content-addressed compiled declaration previews;
their unavailable implementation is explicitly stated.

The first exact 0.3.6 candidate completes the unchanged boostCleaner 25-module model in
239.901 s and passes all five semantic groups, including coerceAtLeast and minutes.
Both language baseline error counts are zero; injected new-line errors are correctly
positioned (Java 14 ms, Kotlin 414 ms). Source hashes are unchanged. Peak owned-process
RSS 1,689,632 KiB; shutdown 2.514 s. This candidate still intermittently loses a
debounced push report in the mixed fixture, so these measurements alone do not close
acceptance. Final package/component identities and repeat runs follow below.

The follow-up uses a private version/digest-bound Kotlin diagnostic pull instead of
waiting 20 s for push. The adapter also invalidates unchanged callers' context, releases
closed Kotlin ownership and retains monotonic private versions across reopen. The
fixture now explicitly checks a dependency signature change affecting an unchanged
caller and discarding/reopening a buffer with errors. No custom Android RPC or compiler
code is added to the host; its standard diagnostic protocol is unchanged.

Final packaged fixture receipt: LSP 0.3.6, 4,649,258 bytes, SHA-256
`03596cc16c0063daca7d87f3b2509f6b1816ae7025ec73db515c803a27dbcada`.
The exact extracted archive passes all 14 checks, including unchanged-caller
diagnostics and close/discard/reopen. Ready 8.071 s, total 40.928 s, peak
1,656,080 KiB, shutdown 906 ms; warm paired definitions p50 6 ms / p95 9 ms.
Java syntax remains responsive in 29 ms while Kotlin is invalid. All owned
processes stop after shutdown. Typecheck, 8 ordinary tests, complete package
inspection and native helper→desktop validator→contribution routing pass.

Component identity is `kotlin-language-server-asterlyn@1.3.13-asterlyn.2.3.21.2`,
archive SHA-256 `dca2069025626c15dc97c4a83601dbbd8ecd18a90bb5854f45d9617a13c55ef0`,
content digest `0cb71b321e42f993f63acd733a6f57eab684b88ac46a4d2ca5870598c408dcbd`,
90,232,335 archive bytes / 115 files. Two independent source rebuilds produce
identical archives. Compiler/KAPT 2.3.21 uses the complete ten-file component
`28f04ffa1a30c2961cb8c71bf655e046ba39ca6d375d2fe81b99e73c842ae1bb`.
Both remain explicit offline, verified analysis components rather than host
compiler dependencies or automatic project dependency downloads.

The same final archive is being rechecked against all 25 unchanged boostCleaner
modules. First full KAPT/JDT preparation can take several minutes and Kotlin ABI
changes currently regenerate the model's stubs; Java syntax diagnostics remain
available during that work, while stale type-dependent requests ask for retry.
Standard library previews expose declarations, not unavailable source bodies.
This milestone does not add Gradle scripts/Groovy/XML/generated-source builds,
full cross-language references or a large-project memory soak guarantee. Existing
keyboard/readonly preview accessibility is retained without a new UI control.

Final exact-package boostCleaner receipt (`real-036-pull.json`): all five semantic
groups and both baseline/injected diagnostic checks pass across the actual 25-module
model. Ready 266.917 s, total 273.958 s, peak owned RSS 1,547,936 KiB; shutdown
2.341 s. Java→Java 216 ms, Kotlin→Java 1,646 ms, Java→Kotlin 1,037 ms; compiled
stdlib coerceAtLeast 318 ms and minutes 116 ms. Java/Kotlin baseline errors are
both zero, injected diagnostics cover the exact appended line (13/390 ms). All
business source hashes remain unchanged and no stderr traffic is observed.

The host's signed 0.1.22 build `9fbe2c4` now bundles this exact 0.3.6 archive, has
passed the exact native package health checkpoints and has replaced the canonical
local installation. Both stored-icon launches record frontend readiness. Final
interactive navigation acceptance is pending macOS unlock; the lock-screen run
of the rendered smoke gate reports WINDOW_MISSING and is not claimed as a pass.

### Final installed native acceptance — 2026-10-28

The unchanged final 0.3.6 archive is now accepted with Android Gradle 0.6.1 on
the installed host 0.1.22 revision `ccca8c7989c768234cf04c99774022dffbee286a`.
Both providers are enabled, active and known-good, with no pending replacement.
The canonical root-preserving installation, strict/deep bundle verification,
rendered shell smoke (30-second observation budget), first icon launch and icon
reopen pass. No remote publication is performed.

Native session `session-1793157545192-34639-0` imports all 25 boostCleaner
modules in 19,500 ms and reaches workspace.ready 313,143 ms after language
session start. Actual Ctrl+left-click navigates from Kotlin AdsRuntimeState.kt
to the three-argument SharedPref.getLong Java declaration (events 128/129),
and from AppUtils.java:297 to GlobalConfigNew.kt (events 132/133). Saved
destination tabs corroborate both native lookup results; F12 also opens the
first target. During indexing the host correctly shows informational indexing
feedback. Business source hashes are unchanged and its worktree remains clean.

The final session through event 136 has no unexpected plugin exit, quarantine,
protocol-limit, timeout or resource-limit event. The host follow-up also records
original helper exit status before EOF cleanup; an earlier separate-window helper
EOF has no proven root cause and is not claimed fixed by that observability
change. Large-project cold preparation still takes minutes. The optional final
native standard-library preview check was interrupted by a later screen lock;
the exact-package protocol preview checks above remain the accepted evidence.

The complete installation/gesture/log receipts and limitations are recorded in
the host's `docs/engineering/2026-10-27-boostcleaner-lsp-recovery.md`, under its
“Final installed native acceptance” section. Local machine evidence is retained
in `/tmp/asterlyn-android-lsp/boost-native-20261028/`.

## Kotlin class-reference source ownership — 2026-10-29 plan

The next user report concerns the `SplashActivity` declaration in boostCleaner.
The installed host already requests semantic references after its empty definition
result, but native queries fail in the adapter. A direct probe of the identical
0.3.6 Kotlin adapter/component returns 33 reference locations: 32 map to admitted
workspace sources and one is the compiler's non-existent `file:///dummy.kt`.
The Android adapter's canonicalization attempts to resolve that transient PSI
location and rejects the complete batch. This is not missing modifier input or
proof that the class has no references. The generic indexing error currently
obscures the real failure; it must not be relabelled as successful indexing.

1. At the Kotlin source-view boundary, admit references only when their source
   URI maps back to an imported workspace file. Omit compiler scratch PSI and
   other unmapped references, without guessing a path, searching symbol names,
   trusting file existence or adding Kotlin logic to the host. Definitions retain
   their separate dependency-source admission. Malformed responses remain errors.
2. Cover mixed owned/scratch locations, all-scratch/null results, malformed values,
   URI normalization and unchanged definition mapping. Re-run the exact real-class
   definition/references probe; retain expected targets and business-source hashes.
3. Produce plugin 0.3.7, verify/package/inspect it, update the host's exact bundled
   pin, run required checks and canonically replace the signed local application.
   Native Command-click must present the class's multiple valid references and
   open the selected source; ordinary class-use-to-definition navigation must also
   work. Record latency, memory, accessible picker state and limits. No remote
   publication or business-source edits are authorized by this fix.

Evidence begins in `/tmp/asterlyn-android-lsp/boost-class-nav-20261029/`.
The earlier method-only acceptance remains bounded to its recorded positions;
it did not establish class-reference compatibility or complete mixed-language usages.

### Implementation and package checks

The 0.3.7 Kotlin adapter filters reference locations against the existing private
source-to-original map before translating their URIs. It does not special-case
`dummy.kt`, trust an existing outside file or change definition/dependency-preview
mapping. Null remains a valid empty result; malformed batches/ranges remain errors.
Four focused ownership tests cover mixed, scratch-only, malformed, external-file
and URI-normalization cases. All 12 plugin tests and typecheck pass.

The repeated real-project probe preserves all 32 original workspace locations
byte for byte while omitting the compiler scratch location. Reference lookup takes
1,129 ms locally; a type use in `ProcessStateMonitor.kt:37` resolves back to
`SplashActivity.kt:60` in 4 ms. Base-class definition mapping remains unchanged.
Locations include imports and receiver uses returned by the semantic server;
this correction does not add Java usages to Kotlin's upstream reference search.
The generic adapter error classification is still a known feedback limitation
for other failures; removing this invalid reference prevents this specific error.

Two deterministic release builds match: 4,649,739 bytes (+481), SHA-256
`ec3e7899064ca67055dcc71370850026cf46110ca919b29d55fda199963db129`.
Native inspection admits content digest
`sha256:63baf0c482e1362d37bc4f27e09a36fadfba16d7942505f93ef8cacf3469da1b`.
No new third-party dependency, compiler component or license is introduced.
Final host package health, canonical installation and native class-picker
acceptance remain pending; the direct probe alone does not close that gate.
