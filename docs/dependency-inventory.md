# Dependency inventory

## Development SDK

| Artifact | Origin | SHA-256 | Status |
| --- | --- | --- | --- |
| `vendor/asterlyn-plugin-sdk-1.11.0-dev.tgz` | Host `packages/plugin-sdk` additive SDK source, local development build | `7fb5cbe2074fb9a66cec5dcca2d71d70bc4cad604abac0631e1bb913ae50f55b` | Unreleased; replace before publication |

The artifact is intentionally named `-dev` and is not evidence of an existing published Release.
The host owner must provide the canonical SDK 1.11.0 tarball and checksum before P2/P3 publication
or host acceptance. No TypeScript server assets are bundled at P1.

## Runtime authority

The plugin runtime imports only SDK types. It does not import Node, filesystem, process, shell, DOM,
Tauri, socket, network, or workspace APIs. Server launch and all editor/LSP operations belong to the
host contribution declared in `src/plugin.ts`.
