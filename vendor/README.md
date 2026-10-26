# Development SDK artifact

`asterlyn-plugin-sdk-1.11.0-dev.tgz` is a local, unreleased development artifact built from the
host repository's additive SDK 1.11 source at implementation time. It is not an upstream Release
and must not be published as one. Replace it with the exact checksum-covered canonical SDK 1.11.0
artifact when the host worker publishes that artifact; update both checksum files and the lockfile.

The plugin imports types only. The SDK artifact has no runtime authority and is used solely to keep
this sibling repository independently installable before the first compatible host Release exists.
