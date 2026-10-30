# Optional Android analysis component distribution

The plugin archive stays approximately 4.7 MB. JDT and patched Kotlin tools are separate opt-in
artifacts, frozen by `manifest.json` and `src/android-profile.ts`. They contain upstream licenses
and notices; source rebuild procedures and original upstream checksums remain in the component
records. Do not include JDK distributions or the user's project/Gradle cache in this release.

To stage an existing accepted set without changing a component identity:

```
node scripts/stage-analysis-components.mjs \
  jdtls=/path/to/jdtls.tar.gz \
  kotlin-language-server-asterlyn=/path/to/kotlin-language-server.tar.gz \
  kotlin-compiler-bridge=/path/to/kotlin-compiler.tar.gz
```

Every input must match the exact frozen SHA-256; missing, unknown and mismatched inputs fail.
Publish `release-components/*.tar.gz`, `components.json` and `SHA256SUMS` once under
[analysis-components-2026-10-30](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/releases/tag/analysis-components-2026-10-30).
Verify GitHub's asset digests after upload. Never overwrite an asset when rebuilding changes its bytes;
change the component identity and test the new manifest instead. Historical temporary filenames are
not download sources. Users download these archives explicitly and import them through the host's
analysis-component installation flow; activation never downloads them automatically.

JDT needs JDK 25; Kotlin runs with JDK 17-24. Real Android project acceptance is currently macOS;
Linux CI verifies package admission/isolated descriptor activation, not a full Android toolchain.
