# Asterlyn LSP plugin

Independent first-party TypeScript/JavaScript language-service plugin for Asterlyn.

Implementation starts only after the [plan](docs/implementation-plan.md) is committed. The host owns
LSP transport, current editor documents, permissions, processes and presentation. This repository
owns the language declaration, pinned server assets, localization and deterministic plugin package.

Initial identity: `dev.asterlyn.lsp`, plugin version `0.1.0`, package schema `3`.
Repository metadata: `guozhiqiang123/asterlyn-plugin-lsp` (local repository only; not published).

Rust support is planned in [the Rust provider plan](docs/rust-support-plan.md), coordinated with the
sibling host's Rust compatibility plan. The current 0.1.0 package remains TS/JS-only; this planning
step does not install components or change its SDK, runtime, manifest or server assets.

## Rust development preview (0.2.0)

Requires host 0.1.21 / SDK 1.12.0 and preinstalled Rustup 1.98.1 components `rust-analyzer` and
`rust-src`. No automatic tool/dependency downloads. Open a Cargo workspace and an editable `.rs`
file, approve Rust separately from TypeScript, then Ctrl-click (or Command-click on macOS) a symbol.
In-workspace definition/reference navigation, hover, basic completion and native diagnostics are
the first scope. Build scripts/procedural macros/check-on-save remain disabled, so generated-code
analysis is partial. External standard-library/dependency source navigation is a later host gate.
This SDK/plugin preview is not a published Release.
