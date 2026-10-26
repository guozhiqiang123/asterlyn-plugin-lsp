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
