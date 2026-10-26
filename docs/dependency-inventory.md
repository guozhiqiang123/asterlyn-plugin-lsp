# Dependency inventory

## Development SDK

| Artifact | Origin | SHA-256 | Status |
| --- | --- | --- | --- |
| `vendor/asterlyn-plugin-sdk-1.11.0.tgz` | Host template canonical SDK artifact | `7fb5cbe2074fb9a66cec5dcca2d71d70bc4cad604abac0631e1bb913ae50f55b` | Host-provided 1.11.0 artifact |

The artifact and checksum now match the host template exactly. This sibling repository does not
publish a Release here; host compatibility still must be reviewed before any future publication.

## Runtime authority

The plugin runtime imports only SDK types. It does not import Node, filesystem, process, shell, DOM,
Tauri, socket, network, or workspace APIs. Server launch and all editor/LSP operations belong to the
host contribution declared in `src/plugin.ts`.
