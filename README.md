# Asterlyn LSP plugin

Independent optional TypeScript/JavaScript, Rust, and Android Java/Kotlin language services for Asterlyn.
The host owns permissions, processes, document synchronization and editor UI. This plugin owns language
profiles, pinned server assets and model adapters. It requires Asterlyn **0.1.23 or newer** and the
Android Gradle plugin **0.6.3 or newer**. Groovy/Gradle DSL semantic support remains deferred.

Install the `.asterlyn-plugin.tgz` from [Releases](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/releases)
through Asterlyn's plugin manager. Android services additionally require explicitly installed,
checksum-verified JDT/Kotlin components, JDK 25 and a Kotlin JDK 17-24. TypeScript uses trusted local
Node.js; Rust uses installed rust-analyzer/rust-src. Project dependencies are never silently installed.

## Development and release

```
npm ci
ASTERLYN_HOST_CHECKOUT=/path/to/asterlyn npm run verify
ASTERLYN_HOST_CHECKOUT=/path/to/asterlyn npm run acceptance
```

The host checkout is a validation tool, never a plugin source or SDK dependency. CI checks out the
fixed host tag in `release-policy.json`. The SDK is the exact vendored canonical artifact; a tag
Release requires byte-for-byte proof from the published host Release and the required Android plugin
Release. Tag/package/manifest versions must agree. See [publication plan](docs/public-release-plan.md).

`package:release` rejects symlinks and writes a deterministic archive, recursive integrity table,
release summary and SHA256SUMS. `package:inspect` always invokes the canonical Rust admission validator;
`acceptance` additionally exercises the isolated plugin helper. The tag workflow uploads the tested
artifact once, round-trips checksums in a draft Release, then publishes it. It never overwrites assets.

Android tool components are separate optional archives, outside the lightweight plugin package;
source versions, licenses, digests, rebuilding and explicit installation are documented in
[component distribution](docs/component-distribution.md), [component records](docs/kotlin-language-component.md) and [compiler records](docs/kotlin-compiler-2.3.21.md).
