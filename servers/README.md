# Pinned TypeScript server assets

The package contains the published `typescript-language-server` 6.0.2 CLI as `typescript/server.mjs`
and TypeScript 5.9.3 under `typescript/typescript/lib`. The host must invoke the fixed entry with
`--stdio` and pass the packaged `tsserver.js` through initialization options; workspace TypeScript,
tsserver plugins and automatic typing acquisition are not admitted.

TypeScript 7.0.2 was checked and rejected for this layout because its published package does not
contain `lib/tsserver.js`. The selected versions were exercised together through stdio with an
unsaved TypeScript document and produced diagnostics, hover, definition and completion responses.

## Rust host profile

`rust-analyzer/profile.json` declares only host profile `cargo-offline-no-build-v1` with toolchain
1.98.1. No Rust binary is bundled. Host 0.1.21 separately resolves/reviews the local Rustup
`rust-analyzer` and `rust-src` components. Rust does not require Node. Cargo operates offline/locked;
build scripts, proc-macros and check-on-save are disabled. Cargo model reload remains enabled.
See `docs/rust-support-plan.md` for staged scope; standard-library/dependency navigation remains R3.
