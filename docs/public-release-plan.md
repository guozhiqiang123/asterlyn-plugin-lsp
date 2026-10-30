# Public release plan: 2026-10-30

User authorization covers commits, host version/tag/push, Actions monitoring, and creating the public LSP repository alongside the existing public repositories.

| Stage | Deliverable | Gate |
| --- | --- | --- |
| R0 | Record plan and commit accepted hover removal | Preserve existing acceptance; inspect remaining changes |
| R1 | Host 0.1.25 and SDK 1.14.0 | Version consistency, frontend/script/format checks, reviewed ordinary Push, successful matrix and SDK Release |
| R2 | Android Gradle 0.6.3 | Update CI validation host; canonical admission and isolated activation; publish the LSP dependency |
| R3 | LSP 0.3.11 first public release | Same-name GitHub repository; fixed published SDK/tool provenance; CI without sibling/local-path dependencies; canonical package admission and isolated activation |
| R4 | Delivery audit | Independently verify remote commit/tag, Actions and Release asset digests; record URLs and limits |

Publish the host through GitRepository preview/ordinary Push, without rewriting remote history. Publish LSP only after the compatible host SDK Release succeeds. Development SDK bytes are not evidence of a published artifact. Freeze existing Kotlin/JDT component archives by manifest digests; distribute only verified archives, retaining source/license records and reusable verification scripts.

## Local acceptance before publication

Plugin 0.3.11, host baseline 0.1.25, SDK 1.14.0. Type check and 26 unit tests pass; repeated
packaging produced identical SHA-256 `59af1a12c994667cff6bc69dc6d8fc03d1854b1483ed6eb287c6ed8ab04eab6d`
for 4,663,870 bytes. Canonical native admission and isolated TS/Rust plus Android descriptor activation
pass. Components are staged only from the three exact manifest digests, distributed separately.
The tag was published only after the host SDK and Android dependency Releases succeeded.

Host v0.1.23 failed strict lint before publication; v0.1.24 is the first intended SDK Release. LSP main CI initially passed at db8ef0f; repeat it against the updated baseline before tagging.

Component distribution Release `analysis-components-2026-10-30` is published; all five GitHub asset digests match local staged files. Component staging now preserves previous output on validation failure and excludes obsolete generated archives on success.

Host v0.1.24 passed SDK and Linux/macOS packaging but Windows found a test-only ExitStatus display assumption. v0.1.25 is the final intended baseline. The Android dependency rehearsal passed with optimized, serial native parity tests (run 41060233332).

## Completed public release

[Repository](https://github.com/guozhiqiang123/asterlyn-plugin-lsp),
[v0.3.11 Release](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/releases/tag/v0.3.11),
[successful tag Actions](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/actions/runs/41064897573).
The immutable tag points to `98be74bb199d8f351ed2e2c58e749d58d880f2f5`.
Host v0.1.25 SDK and Android Gradle v0.6.3 were published and checked before tagging.

The fresh public package is 4,662,489 bytes, SHA-256
`f35aa0ffd9b177985f78c94c35ff75819b612d6768b7dd9fe7734eb9bfccb916`.
All three asset digests, package summary and SHA256SUMS agree; canonical native admission passes.
This published checksum supersedes the earlier local-build delivery identity above. Canonical
checkout line endings and pinned Node 24.19.0/zlib are required for compressed-byte reproducibility;
Node 26 produced identical normalized tar content but a different gzip stream.

The workflow verifies the actual published SDK and required dependency Release, native admission,
isolated descriptor activation, tested artifacts and a draft-asset download round trip. Android
components remain separately versioned and explicitly installed. Cross-platform CI activation
is not full real-project Android LSP acceptance on each operating system.
