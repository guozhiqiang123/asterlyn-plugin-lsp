# Public release plan: 2026-10-30

User authorization covers commits, host version/tag/push, Actions monitoring, and creating the public LSP repository alongside the existing public repositories.

| Stage | Deliverable | Gate |
| --- | --- | --- |
| R0 | Record plan and commit accepted hover removal | Preserve existing acceptance; inspect remaining changes |
| R1 | Host 0.1.23 and SDK 1.14.0 | Version consistency, frontend/script/format checks, reviewed ordinary Push, successful matrix and SDK Release |
| R2 | Android Gradle 0.6.3 | Update CI validation host; canonical admission and isolated activation; publish the LSP dependency |
| R3 | LSP 0.3.11 first public release | Same-name GitHub repository; fixed published SDK/tool provenance; CI without sibling/local-path dependencies; canonical package admission and isolated activation |
| R4 | Delivery audit | Independently verify remote commit/tag, Actions and Release asset digests; record URLs and limits |

Publish the host through GitRepository preview/ordinary Push, without rewriting remote history. Publish LSP only after the compatible host SDK Release succeeds. Development SDK bytes are not evidence of a published artifact. Freeze existing Kotlin/JDT component archives by manifest digests; distribute only verified archives, retaining source/license records and reusable verification scripts.

## Local release acceptance

Plugin 0.3.11, host baseline 0.1.25, SDK 1.14.0. Type check and 26 unit tests pass; repeated
packaging produced identical SHA-256 `59af1a12c994667cff6bc69dc6d8fc03d1854b1483ed6eb287c6ed8ab04eab6d`
for 4,663,870 bytes. Canonical native admission and isolated TS/Rust plus Android descriptor activation
pass. Components are staged only from the three exact manifest digests, distributed separately.
The tag Release remains blocked until host SDK and Android dependency Releases are published.

Host v0.1.23 failed strict lint before publication; v0.1.24 is the first intended SDK Release. LSP main CI initially passed at db8ef0f; repeat it against the updated baseline before tagging.

Component distribution Release `analysis-components-2026-10-30` is published; all five GitHub asset digests match local staged files. Component staging now preserves previous output on validation failure and excludes obsolete generated archives on success.

Host v0.1.24 passed SDK and Linux/macOS packaging but Windows found a test-only ExitStatus display assumption. v0.1.25 is the final intended baseline. The Android dependency rehearsal passed with optimized, serial native parity tests (run 41060233332).
