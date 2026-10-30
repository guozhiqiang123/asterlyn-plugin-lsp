# Canonical SDK artifact

`asterlyn-plugin-sdk-1.12.0.tgz` and its checksums are copied byte-for-byte from the host template's
canonical SDK artifact. The host Release and this plugin's eventual publication remain separately
gated; this repository does not create or publish either one.

The plugin imports types only. The SDK artifact has no runtime authority.

SDK 1.12.0 is a development-only canonical artifact until host 0.1.21 publishes its Release.

SDK 1.13.0 is the exact unpublished development artifact generated in the sibling host on 2026-10-27. It adds static required-plugin declarations; SHA-256/SHA-512 and the npm lock bind the vendored bytes. No GitHub SDK Release is implied.

## Public SDK provenance for 0.3.11

Current SDK: 1.14.0; exact SHA-256 `3de0a44594d014298b4129c719b84a4544c834966e63c75a090db085fd43e761`.
The first public plugin Release is gated on Asterlyn v0.1.25 publishing these exact bytes.
`release-policy.json` and CI verify the downloaded Release artifact; the older development-only
notes above remain historical and are not publication evidence.
