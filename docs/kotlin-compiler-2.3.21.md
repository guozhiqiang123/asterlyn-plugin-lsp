# Kotlin compiler component 2.3.21 (development proof)

This is a development-only, locally verified component proof. It is not a
published Kotlin or Asterlyn release and must not reuse the identity of the
official fwcd `kotlin-language-server` 1.3.13 distribution.

## Fixed Maven inputs

The artifacts were fetched over HTTPS with TLS 1.2 or newer from
`https://repo1.maven.org/maven2` and checked against these SHA-256 values before
packaging:

| Coordinate | SHA-256 |
| --- | --- |
| `org.jetbrains.kotlin:kotlin-compiler-embeddable:2.3.21` | `d3e70fb011675e77ef00f1a68918d3cd91eed26058977d1e3ea2a37a293233af` |
| `org.jetbrains.kotlin:kotlin-annotation-processing-embeddable:2.3.21` | `7e8e36c0a349d67244c41e43adb4c482fa18ce0db042306515540f6c9ac2d476` |
| `org.jetbrains.kotlin:kotlin-stdlib:2.3.21` | `6f64eac736db9434dd6925b4a518b9d1d17177652320c37916cf9ba3ce7d7d7a` |
| `org.jetbrains.kotlin:kotlin-script-runtime:2.3.21` | `ec61bf1229c837fa9f4255f34ca69816138b73158e7ae9b8d964cf92ca6dfd2e` |
| `org.jetbrains.kotlin:kotlin-reflect:1.6.10` | `3277ac102ae17aad10a55abec75ff5696c8d109790396434b496e75087854203` |
| `org.jetbrains.kotlin:kotlin-daemon-embeddable:2.3.21` | `222fc10a3c22e74d30369bf8a0ca6c4f9372eac7d4a0081e290c256fa4d30fb2` |
| `org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.8.0` | `9860906a1937490bf5f3b06d2f0e10ef451e65b95b269f22daf68a3d1f5065c5` |
| `org.jetbrains:annotations:23.0.0` | `7b0f19724082cbfcbc66e5abea2b9bc92cf08a1ea11e191933ed43801eb3cd05` |

The runtime set includes the five direct runtime dependencies declared by
the compiler embeddable POM and the mediated `org.jetbrains:annotations:23.0.0`
transitive dependency required by stdlib/coroutines. They are included in this component so a later
server profile can consume a complete matching runtime rather than silently
mixing ambient Kotlin libraries.

All artifacts are Apache-2.0. The archive includes the complete Apache license
text and a generated `NOTICE.json` containing coordinates, checksums, source
mirror and runtime-dependency inventory.

## Reproducible local build

The receipt and downloads used for this proof are under:

`/tmp/asterlyn-android-lsp/kapt-2.3.21-proof/`

The script keeps the existing 2.2.0 receipt interface and accepts 2.3.21 only
with the exact allow-listed artifact names, coordinates and checksums:

```sh
python3 scripts/package-kotlin-compiler-component.py \
  --receipt /tmp/asterlyn-android-lsp/kapt-2.3.21-proof/receipt.json \
  --output /tmp/asterlyn-android-lsp/kapt-2.3.21-proof/kotlin-compiler-bridge-2.3.21.tar.gz
```

The deterministic archive is 61,104,615 bytes with SHA-256:

`28f04ffa1a30c2961cb8c71bf655e046ba39ca6d375d2fe81b99e73c842ae1bb`

An independent second invocation produced byte-identical output. The generic
host installer then accepted it in an isolated store as:

```text
id:             kotlin-compiler-bridge
version:        2.3.21
archiveDigest:  sha256:28f04ffa1a30c2961cb8c71bf655e046ba39ca6d375d2fe81b99e73c842ae1bb
contentDigest:  sha256:59977dd7d3657dec321afa23d58676e5a9207a04fbe317884b63ff6374f8a645
files:          10
content bytes:  67045104
```

The receipt was installed at the isolated proof store below; no user component
store or remote repository was changed:

`/tmp/asterlyn-android-lsp/kapt-2.3.21-proof/component-store/kotlin-compiler-bridge/2.3.21/28f04ffa1a30c2961cb8c71bf655e046ba39ca6d375d2fe81b99e73c842ae1bb/receipt.json`

The existing Kotlin 2.2.0 build remains byte-compatible with the component
already pinned by the Android profile. Using the historical receipt (including
its legacy notice shape and license-byte boundary) reproduces the 52,224,609
byte archive with SHA-256
`58a12d60fcd67503d0617d18b4d45f882c3d078f4e132053b66acd0d91f77077`.
The script's 2.3.21 path intentionally does not use this legacy output format.

Receipt validation was also exercised with a wrong artifact checksum, missing
2.3.21 runtime entry and mismatched coordinate; each was rejected before an
archive was created.

Root independently rebuilt this exact complete archive and admitted its immutable
receipt to the normal component store. It will be selected by the new profile;
the earlier incomplete candidate remains unused.

The development 0.3.6 profile pins this complete component together with the
matching Kotlin 2.3.21 server fork. The earlier incomplete candidate is never
selected by that profile; final packaged and installed acceptance is recorded
in the Android acceptance document.

The initial nine-file candidate failed a real two-module KAPT run with
`NoClassDefFoundError: org/jetbrains/annotations/Nullable`. It was not used by
a shipped profile. The complete ten-file component above fixes that missing
transitive input; the KAPT run now exports both modules' own metadata and six
input digests in 4.483 s. The source jar was fetched through Maven Central's
HTTPS Apache mirror and its published SHA-1 was verified before freezing the
SHA-256 above. The 2.3.21 compiler has its own runtime classpath and no longer
borrows the language-server component's jars.
