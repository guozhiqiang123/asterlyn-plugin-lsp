# P3 acceptance evidence

Run on macOS 2026-10-26:

```text
ASTERLYN_HOST_CHECKOUT=/Users/gzq/PrivateProjects/asterlyn npm run acceptance
```

The harness first calls the host `asterlyn-plugin-inspect` admission binary, then extracts the
archive and launches the host's native `asterlyn-plugin-host` helper. Activation is performed over
the production framed protocol, not by importing the plugin descriptor. The helper returned one
`languageService` contribution with id `typescript-javascript` and server profile `typescript`,
then shut down in 1 ms after a `windowClosed` request.

Recorded archive evidence:

- host compatibility checked with development host version `0.1.20`;
- package SHA-256: `2a3cec68eb06fd13ece09f3935e15fda30ef853ee4d240c4c3bf9d1e82cbe6d9`;
- compressed package bytes: 4,579,083;
- uncompressed tar entry bytes: 24,576,076;
- integrity entries: 133;
- largest resource: `servers/typescript/typescript/lib/typescript.js` (9,112,572 bytes);
- isolated helper activation and cleanup: passed.

The measured helper shutdown latency was 51 ms on this run.

The sibling server test separately exercises the actual bundled server over stdio with unsaved
Unicode/CRLF TypeScript and diagnostics, hover, definition, completion, and EOF cleanup. This is
macOS evidence only; Windows/Linux native acceptance remains unclaimed. The host SDK 1.11 artifact
and host development build are not a published Release.
