# Kotlin diagnostics version gate (development component)

This component is a minimal source patch for fwcd Kotlin Language Server 1.3.13. It is based on
the public repository commit `6d9e61b79d4631e75516def7ab7ff0d8b9310467` and the published archive
SHA-256 `4fe7d71d087b307c7869036171bd9d8c6a4284cd7c25b89098b0a24eb2d9b6d2`.

The patch captures the exact open-document text and LSP version immediately before compilation.
Diagnostics are published only if both text and version still match after compilation; the
`PublishDiagnosticsParams.version` field is set to that captured version. Empty diagnostic clears
carry the same version. An edit that arrives while compilation is running therefore causes the
older result to be discarded instead of being relabelled as current.

The patched development JAR was built from the bundled Kotlin compiler 2.1.0 and the server's
published libraries. Its SHA-256 is
`cf2d33701e24a6f5f000e7ed6f713e2ee1b51663434efd7b0bf567651fff0d87` and its size is 477,673 bytes.
The reproducible source change is in `diagnostics-version.patch`. The normal Gradle build could not
be used in the probe environment because Maven Central returned HTTP 403 for the Kotlin Gradle
plugin; compilation was performed directly with the exact compiler JAR already present in the
published archive. A release build must run the locked dependency build and record its complete
receipt before packaging.

The component remains development-only until its source build and license receipt are frozen in the
plugin package. It does not add Java document handling to Kotlin; the host adapter must route Java
documents to the Java service and provide Java sources through the private shadow classpath.
