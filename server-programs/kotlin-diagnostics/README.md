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
published libraries. This is a reproducible patch build of the complete upstream server JAR;
it is not a claim that the complete upstream source tree was rebuilt. Its reproducible SHA-256 is
`080db08585bb91a144c92b7f57b52064e1ce7f0482efa82b086308147f3f2d6f` and its size is 477,673 bytes.
The reproducible source change is in `diagnostics-version.patch`. The normal Gradle build could not
be used in the probe environment because Maven Central returned HTTP 403 for the Kotlin Gradle
plugin; compilation was performed directly with the exact compiler JAR already present in the
published archive. A release build must run the locked dependency build and record its complete
receipt before packaging.

The component remains development-only until its source build and license receipt are frozen in the
plugin package. It does not add Java document handling to Kotlin; the host adapter must route Java
documents to the Java service and provide Java sources through the private shadow classpath.

## Offline build

`build.mjs` requires a clean checkout at the pinned commit, an already verified fwcd distribution
root, a JDK, and a manifest covering every regular file in that distribution. The manifest records
relative path, byte length, and SHA-256; paths are sorted and validated, symlinks are rejected, and
the complete list is hashed before compilation. It archives the local checkout, applies
`diagnostics-version.patch`, and invokes the Kotlin compiler JARs from that distribution's
`server/lib` directory. It never invokes Gradle, resolves Maven coordinates, downloads files, or
reads project credentials. The output is based on the untouched `server-1.3.13.jar` and receives
deterministic timestamps for patched classes.

Example (the manifest is generated once from the verified, pinned archive and checked into the
build receipt):

```text
node build.mjs <fwcd-source> <distribution-root> <jdk-home> <output.jar> <distribution-manifest.json>
```
