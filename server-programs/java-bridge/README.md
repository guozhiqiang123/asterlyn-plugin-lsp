# Asterlyn JDT bridge

This first-party bundle contains only the delegate command handlers in `src/`.
It is compiled against the admitted JDT LS plugin directory and is reproducible
with the pinned JDK/JDT paths; no JDT or JDK classes are copied into this JAR.

```sh
node scripts/build-java-bridge.mjs <jdk-25-home> <jdtls-root> server-programs/java-bridge.jar
```

The current reproducible artifact is 7,859 bytes with SHA-256
`caa39507e93acf7b5c2567a6bf137e20a2ff6fcc9ddbe2771daed17cdddf4d6c`.
An independent second build produced byte-identical output.

`asterlyn.java.documentDiagnostics` accepts the existing `{uri, version,
digest}` request and an optional boolean `syntaxOnly` field. The response remains
`{version, digest, items}`. When `syntaxOnly` is true, only JDT problems whose
ID has the public `IProblem.Syntax` category bit are returned; semantic/type
problems are deliberately omitted while an external ABI is being rebuilt. The
working-copy digest and post-reconcile digest checks remain mandatory in both
modes.

The real regression should open a Java working copy containing one parser error
and one unresolved/type error, issue the command twice with the same version and
digest, and assert that `syntaxOnly:true` contains only the parser diagnostic
while `syntaxOnly:false` contains the type diagnostic as well. The request must
then be repeated after changing the buffer and version to verify the existing
stale-content rejection.

The direct JDT regression is runnable without the Kotlin backend:

```sh
node server-programs/java-bridge/test-syntax-only.mjs \
  /path/to/agp-model.json /path/to/jdtls-1.62.0 /path/to/jdk-25
```

Against the reviewed fixture it passed with syntax IDs
`1610612976,1610612968,...` and full-mode IDs beginning with `16777233`
(`IProblem.TypeMismatch`); the type mismatch was absent from syntax-only output.
Both responses retained version 7 and the exact SHA-256 digest, and a wrong
digest was rejected.
