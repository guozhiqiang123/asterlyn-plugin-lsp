# LSP plugin repository instructions

1. Read `docs/implementation-plan.md` before implementation; record each stage and real evidence.
2. Plugin source has no Node, filesystem, process, shell, DOM, Tauri or network authority. Server
   processes and editor changes belong to the host. Build/test scripts may use normal developer tools.
3. Respect the frozen contribution and server resource layout in host ADR-0034. Coordinate changes
   with the host owner before changing the public shape.
4. Vendor exact checksum-covered SDK artifacts and lock production dependencies. No sibling source
   imports, symlink dependencies or ad-hoc host SDK copies disguised as a published Release. Mark an
   unreleased canonical SDK as development-only until its host Release exists.
5. Pin upstream versions/integrity, retain license texts and record sources, digest, archive growth
   and runtime constraints before bundling server assets. No automatic project dependency installation.
6. Commit documentation first, then small tested stages. Do not create/push remote repositories, tags
   or Releases without a separate user instruction. Never revert other agents' changes.
