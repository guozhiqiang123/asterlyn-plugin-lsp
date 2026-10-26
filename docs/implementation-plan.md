# Independent LSP plugin implementation plan

- Date: 2026-10-26. Status: planned; source implementation follows this initial committed plan.
- User selected TypeScript/JavaScript as the first language family.
- Host repository: `/Users/gzq/PrivateProjects/asterlyn`.
- Contract authority: host `docs/architecture/decisions/0034-plugin-language-services.md`.
- Identity: `dev.asterlyn.lsp`; version `0.1.0`; repository metadata
  `guozhiqiang123/asterlyn-plugin-lsp`; no remote publication is authorized.

## Frozen integration contract

SDK 1.11 adds `SdkLanguageServiceContribution` with `kind: "language-service"`, `id`, `label`,
`serverId: "typescript"`, `languageIds`, `extensions` (lowercase dot suffixes), and `rootMarkers`
(bounded contained marker names). The manifest declares capability `languageServices` and permission
`host.language-services.execute`. Source uses only type imports from the standalone vendored SDK.

The fixed integrity-covered server entry is `servers/typescript/server.mjs`; the pinned TypeScript
implementation is `servers/typescript/typescript/lib/tsserver.js`. Host resolves trusted Node and
constructs stdio launch/options. Plugin metadata has no executable, argv, environment, socket or
arbitrary path authority. Coordinate any unavoidable resource/CLI layout change with the host owner
before implementation.

## Stages / commits

| Stage | Deliverable | Acceptance |
| --- | --- | --- |
| P0 | This plan, repository boundary and frozen contract | Commit before runtime implementation |
| P1 | Standalone package, SDK artifact, TS/JS matching, language contribution, localization, disposal | Contract/identity/matching/negative tests and type check; commit metadata/runtime separately |
| P2 | Pin official published TypeScript language server and TypeScript, record licenses/integrity, build fixed server assets and deterministic schema-3 archive | Repeated package bytes identical; complete integrity/license validation; no runtime sibling imports; commit packaging |
| P3 | Inspect with current native host inspector, activate through isolated helper, exercise real server diagnostic/hover/definition/completion from unsaved source | Host/plugin integration evidence, missing-tool/error/stale/cancel/disposal checks; commit evidence/corrections |

## Matching and presentation

Declare TypeScript, TSX, JavaScript, JSX and conventional module variants through the exact negotiated
host language IDs. Root markers include tsconfig.json, jsconfig.json and package.json. Matching uses
bounded host evidence only and never launches a server. Descriptor activation may remain available
on an empty workspace so opening the first matching document works. If evidence is incomplete,
retain a deterministic safe policy rather than reading files directly.

All UI, configuration review and execution approval belongs to the host. A plugin contribution
does not grant startup authority; disabled/untrusted/missing-tool states remain visible and base
editing stays usable. Native servers execute as the user; do not describe them as OS-sandboxed.

## Dependency and compatibility policy

Use only published upstream packages, pin versions and npm lock integrity, retain licenses and list
original repositories. No IDE/product source extraction. New SDK 1.11 is initially an unreleased
canonical host artifact; record its origin/digest and block public Release publication until a
compatible host Release exists. Keep the host app's current version distinct from capability
availability: an older same-version host must reject the unknown required capability.

No automatic server download, project npm install, project-selected TypeScript or tsserver plugin
loading. Bundle the reviewed server/TypeScript implementation where size gates permit. Host Node
resolution is separate; document its minimum runtime and actionable unavailable state.

## Acceptance and limits

- Type check, focused tests, deterministic package build, canonical package inspection and actual
  isolated activation; local metadata-only invocation is insufficient.
- Real server must handle TypeScript and JavaScript, unsaved changes, Unicode positions, cancellation
  and EOF. Host owns independent worktree/window session identities and stale-result rejection.
- No source/payload logging, ambient plugin APIs, unbounded resource extraction or silent fallback to
  a project-installed server. Record package bytes, license set and resource/latency measurements.
- Initial feature set: diagnostics, hover, definition, basic completion. WorkspaceEdit, rename, file
  operations, executeCommand, other languages and remote servers require later host capability gates.
- No claim of Windows/Linux runtime acceptance from a macOS run.

## Execution record

- P0: committed before source implementation.
- P1–P3: pending.
