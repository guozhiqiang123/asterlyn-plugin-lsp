# Language-service package acceptance — 2026-10-26

This is macOS-only evidence. Windows and Linux runtime acceptance is not claimed.

## Reproducible commands

From this repository, with the unreleased host checkout available:

```text
npm run check
npm test
npm run package:release
npm run package:inspect
ASTERLYN_HOST_CHECKOUT=/Users/gzq/PrivateProjects/asterlyn npm run acceptance
node scripts/measure-language-service.mjs
```

The checks passed on macOS with Node `26.8.1`. The host acceptance used development host
`0.1.20`; the SDK `1.11.0` artifact is unreleased and no public Release was used.

## Package and host evidence

- Archive: `dev.asterlyn.lsp-0.1.0.asterlyn-plugin.tgz`
- Compressed bytes: `4,579,083`
- SHA-256: `2a3cec68eb06fd13ece09f3935e15fda30ef853ee4d240c4c3bf9d1e82cbe6d9`
- Expanded tar entry bytes: `24,576,076`
- Integrity entries: `133`
- Largest resource: `servers/typescript/typescript/lib/typescript.js` (`9,112,572` bytes)
- Package inspector: passed the host's sealed admission path
- Isolated plugin helper: activated the `typescript-javascript` contribution with server profile
  `typescript`, then shut down successfully
- Native helper shutdown: `79 ms` in the recorded run

The host resource must retain this exact archive digest; it is not repacked by the measurement
script. Installing or enabling the descriptor does not itself start a server.

## Actual server measurements

`measure-language-service.mjs` starts the packaged `servers/typescript/server.mjs --stdio` in a
detached, per-run process group and supplies the packaged TypeScript `tsserver.js` path. It uses
temporary unsaved CRLF documents containing a non-ASCII identifier and verifies a diagnostic,
hover, definition and completion response before EOF cleanup.

| Document | Initialize | Diagnostics | Hover | Definition | Completion | Group RSS sample | Cleanup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TypeScript | 65.80 ms | 1 | 10.93 ms | 10.93 ms | 32.16 ms / 1,002 items | 547,584 KiB | 90.14 ms |
| JavaScript | 76.04 ms | 0 | 11.02 ms | 10.30 ms | 43.24 ms / 1,027 items | 556,368 KiB | 316.15 ms |

All process-group PIDs were absent after bounded cleanup. The JavaScript run required the script's
owned process-group termination fallback; this is recorded as `cleanupForced: true`, with no
remaining PIDs. RSS is an observed macOS process-group sample, not a hard process-tree memory cap.

The enforced package-side document bounds used by the host contract are 2 MiB per document and
32 documents per session. The plugin does not claim an OS sandbox or a hard memory limit.

## Stage record and remaining review

- P0 plan and frozen contract: `a425d43`.
- P1 standalone descriptor, SDK artifact, matching, localization and disposal: `eac2a35`.
- P2 pinned TypeScript language-server/TypeScript assets, licenses, integrity and deterministic
  archive: `c08c6ff`.
- P3 real stdio server, native inspector and isolated helper activation: `970f047`.
- Measurement script and this evidence are follow-up acceptance evidence; they do not change the
  sealed archive bytes.

The remaining gate is the host owner's manual native UI/session review (installed app/editor
rendering, tab/workspace separation and user-visible approval/disable states). This repository
does not claim that UI gate is complete. Rename, code actions, WorkspaceEdit, file operations and
other server commands remain disabled and require a later host capability review.
