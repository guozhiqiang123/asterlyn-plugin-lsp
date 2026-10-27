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

## Release gate

This candidate is not yet a product Android profile. Its diagnostics notifications omit the LSP
document version (`version: null`), and the server does not advertise `textDocument/diagnostic`.
Assigning the current overlay version on receipt would be unsafe because an older asynchronous
reconcile could arrive after a newer edit. The adapter must either obtain a versioned/pull
diagnostics extension or explicitly expose Kotlin diagnostics as unavailable.

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
