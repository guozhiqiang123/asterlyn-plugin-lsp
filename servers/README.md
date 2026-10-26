# Pinned TypeScript server assets

The package contains the published `typescript-language-server` 6.0.2 CLI as `typescript/server.mjs`
and TypeScript 5.9.3 under `typescript/typescript/lib`. The host must invoke the fixed entry with
`--stdio` and pass the packaged `tsserver.js` through initialization options; workspace TypeScript,
tsserver plugins and automatic typing acquisition are not admitted.

TypeScript 7.0.2 was checked and rejected for this layout because its published package does not
contain `lib/tsserver.js`. The selected versions were exercised together through stdio with an
unsaved TypeScript document and produced diagnostics, hover, definition and completion responses.
