# Server asset provenance

| Asset | Version | Source | npm integrity | License |
| --- | --- | --- | --- | --- |
| `servers/typescript/server.mjs` | typescript-language-server 6.0.2 | https://registry.npmjs.org/typescript-language-server/-/typescript-language-server-6.0.2.tgz | `sha512-Ph7Ql+xkUJvMamnkh1h+aKP6HxLR7lrWIYkPn9/LZBkJdJZgtIj7OoVhkDYtQ7zFPTPmqZHOVXaUKGyz9M2q1Q==` | Apache-2.0 |
| `servers/typescript/typescript/lib/**` | TypeScript 5.9.3 | https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz | `sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==` | Apache-2.0 |

The TypeScript package includes its complete published `lib` tree, `LICENSE.txt`, and
`ThirdPartyNoticeText.txt`. The language-server package is a self-contained bundled CLI and its
original LICENSE is retained. No optional native TypeScript packages are included; the selected
assets are pure JavaScript and host Node is the only runtime prerequisite.

The host must supply an absolute packaged `tsserver.js` initialization path and must not resolve a
workspace-selected TypeScript implementation. The server is launched only as `server.mjs --stdio`.
