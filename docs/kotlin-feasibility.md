# Kotlin backend feasibility record

Date: 2026-10-27

## Candidate

The probe used the published fwcd Kotlin Language Server 1.3.13 archive. The archive SHA-256 is
`4fe7d71d087b307c7869036171bd9d8c6a4284cd7c25b89098b0a24eb2d9b6d2`; its bundled compiler is
Kotlin 2.1.0 and the server is Apache-2.0 according to its distribution license report. It was
run as a separately verified development tool with Temurin/JBR 17. No IDE files or sources were
copied into the server package.

## Android model probe

The input was the AGP model in `/tmp/asterlyn-android-lsp/common-model.json`, selected module
`:common` and variant `cleanx100Debug`. The probe created a private shadow workspace with eight
linked source roots, one Android boot classpath and 56 compile classpath entries. A private
`XDG_CONFIG_HOME/kotlin-language-server/classpath` script supplied the exact model classpath, so
the server did not run Gradle discovery or inspect the user's original project metadata.

Evidence is retained in `/tmp/asterlyn-android-lsp/kotlin-proof/summary.json` and
`run2.log`.

The real mixed source fixture produced:

- Kotlin `Pref.kt` → Java `ContextHolder.java` definition: returned a concrete file range.
- Kotlin `SharedPreferences` hover: returned the Kotlin interface declaration.
- Kotlin unsaved text change: emitted two diagnostics for the changed document.
- Initialize completed in 1.0 seconds; the full probe completed in 18.5 seconds; stderr was 210
  bytes and contained no source or credential dump.

## Versioned diagnostics development patch

The original 1.3.13 notifications omit the LSP document version (`version: null`), and the server
does not advertise `textDocument/diagnostic`. A small source patch now captures the exact open
document text/version before compilation, compares both values before publication, sets
`PublishDiagnosticsParams.version`, and drops a result whose snapshot is stale. The patch and
build receipt are recorded under `server-programs/kotlin-diagnostics/`; it is based on fwcd commit
`6d9e61b79d4631e75516def7ab7ff0d8b9310467`.

The patched development JAR was exercised against the same Android model. After an invalid version
2 edit was immediately superseded by a valid version 3 edit, the final diagnostics snapshot was
`version: 3, count: 0`; the stale invalid result was not published. Evidence is retained in
`/tmp/asterlyn-android-lsp/kotlin-proof/summary.json` and `patched-run2.log`.

The component is still development-only until its source build is reproducible with locked
dependencies and its complete license/integrity receipt is admitted by the host.

The probe also found that opening a Java document inside the Kotlin source workspace triggers the
1.3.13 server's script-compilation path and fails with `Unable to find script compilation
configuration ... Bridge.java`. Therefore this release proves Kotlin-to-Java navigation, but not
Java-to-Kotlin navigation or safe mixed-language ownership. The failure is recorded rather than
hidden behind a search-based fallback.

## Next gate

Keep fwcd 1.3.13 development-only while investigating a legally distributable backend with
versioned diagnostics and mixed Java/Kotlin project support. A Kotlin profile may be registered
only after real Kotlin↔Java definitions, hover, completion and current-version diagnostics pass on
the same AGP model and dirty overlays. The Android model and private classpath handoff demonstrated
here remain reusable for that backend.
