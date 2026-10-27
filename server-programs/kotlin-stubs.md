# Kotlin-to-Java stub bridge investigation

The initial `kotlin-stubs.mjs` experiment was removed and must not be used. It attempted to infer
origins from `javap` output and package names. That is not a valid compiler source mapping: it can
select the wrong file for same-package sources, loses overload identity, does not preserve fields
or generics, and cannot support Android's partial/generated model.

The supported design requires Kotlin's public KAPT compiler plugin and its `.kapt_metadata` origin
mapping. The intended fixed artifact is:

```text
org.jetbrains.kotlin:kotlin-annotation-processing-embeddable:2.1.0
```

The fwcd distribution does not include this plugin. An attempted download from Maven Central
(`repo1.maven.org` and `repo.maven.apache.org`) was rejected with HTTP 403 in the probe
environment, so no unverified or IDE-extracted binary was accepted. The component must be fetched
through the normal dependency intake, recorded with license/version/SHA-256, then used with
`aptMode=stubs` and `correctErrorTypes=true`.

Before product integration, the bridge must prove all of the following with a multi-file fixture:

- same-package declarations resolve to their actual source file;
- overloaded methods and fields retain distinct origin ranges;
- Java→Kotlin and Kotlin→Java navigation works with unsaved overlays;
- missing Android generated/R classes do not prevent ABI stub generation;
- `.kapt_metadata` maps generated stub ranges back to Kotlin UTF-16 ranges.

Until those gates pass, Java→Kotlin remains owned by the existing Kotlin backend/JDT integration;
this investigation is intentionally not a product API.
