# Maintained Kotlin 2.3.21 analysis component

This publisher-owned component rebuilds pinned MIT fwcd source commit
`6d9e61b79d4631e75516def7ab7ff0d8b9310467` with Kotlin 2.3.21. It is not the upstream
1.3.13 distribution; the pinned source tree's own development JAR version is 1.3.14.
The complete fork is `fwcd-core.patch`, SHA-256
`0d90050f1145296aaa8b01e44fca07357f690d915e167baf6de200c92e868931`.
`dependencies.lock.json` is the public dependency/license inventory with developer paths removed.
A local build receipt must add each verified downloaded artifact's `path` and matching license
`licensePath`; the build tool validates the pinned hashes rather than trusting filenames.
The full MIT text is retained in `../kotlin-diagnostics/LICENSE-MIT.txt` and the component itself.

The fork preserves exact text/version diagnostic snapshots, encoded URI handling and lazy
closed-file compilation. The internal `kotlin/asterlynDocumentDiagnostics` request binds an
open snapshot to its UTF-8 SHA-256 and version, and rejects document/dependency changes with
ContentModified. A global semantic epoch expires per-file compiled bindings on dependency
edits; ordinary edits retain parsed PSI and only requested files are compiled. Its K1 adapter uses stable 2.3 language defaults, fixed 2.3 compiler
container services and narrow explicit opt-ins. Gradle scripts and JVM code generation are
explicitly unsupported. The Android profile selects only Java/Kotlin source files.

Resolved deserialized Kotlin library declarations have a typed, content-addressed, read-only
preview when source PSI is absent. Imported object callables are unwrapped through the compiler's
actual wrapper before proving binary origin; project, Java and arbitrary sourceless synthetic
descriptors never gain a fake definition. The preview states that its implementation is not
available, preserves fully qualified types and uses bounded UTF-8 content and UTF-16 ranges.
It does not fabricate workspace source or search by a symbol name.

Build with `scripts/build-kotlin-language-component.py`; complete inputs, provenance, licenses,
archive identities and local measurements are described in `docs/kotlin-language-component.md`.
The runtime consists of `server/lib/asterlyn-kotlin-server.jar`, `shared-asterlyn.jar` and the
fixed dependency set; the old 2.1 patch JAR is never mixed into this component.
