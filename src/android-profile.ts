import type {SdkPackagedLanguageServer,SdkPluginMatchContext} from "@asterlyn/plugin-sdk";
export const ANDROID_PROFILE = Object.freeze({
  "id": "android-jvm",
  "program": {
    "entry": "server-programs/android-server.mjs",
    "tools": [
      {
        "id": "serverJava",
        "kind": "java",
        "minimumMajor": 25,
        "maximumMajorExclusive": 26
      },
      {
        "id": "kotlinJava",
        "kind": "java",
        "minimumMajor": 17,
        "maximumMajorExclusive": 25
      }
    ],
    "components": [
      {
        "id": "jdtls",
        "version": "1.62.0",
        "archiveDigest": "sha256:f587dafd8410633c2c2bf005e853a2bbb03cddee88933d49bfe6d9cb1cf09342",
        "contentDigest": "sha256:ca0c9c9f4797c8273bc39f8d786f63fa87a6ef2b4ac4d4577fc49646761e4126"
      },
      {
        "id": "kotlin-language-server-asterlyn",
        "version": "1.3.13-asterlyn.2.3.21.4",
        "archiveDigest": "sha256:5ca0323ccef08625a87dba1155482617c7c5018e52975ef2ec8074e1d48e9f0d",
        "contentDigest": "sha256:24f6668de90579dff300f7e0c2df4623a73f3ce5a5d2322704fb8b8ba140ed97"
      },
      {
        "id": "kotlin-compiler-bridge",
        "version": "2.3.21",
        "archiveDigest": "sha256:28f04ffa1a30c2961cb8c71bf655e046ba39ca6d375d2fe81b99e73c842ae1bb",
        "contentDigest": "sha256:59977dd7d3657dec321afa23d58676e5a9207a04fbe317884b63ff6374f8a645"
      }
    ]
  },
  "selectors": [
    {
      "languageId": "java",
      "extensions": [
        ".java"
      ]
    },
    {
      "languageId": "kotlin",
      "extensions": [
        ".kt"
      ]
    }
  ],
  "model": {
    "pluginId": "dev.asterlyn.android-gradle",
    "serviceId": "android-gradle-model",
    "schema": 1
  }
} as const) satisfies SdkPackagedLanguageServer;
/** Same complete-catalog contract used by the required Android build provider. */
export function isAndroidWorkspace(context:SdkPluginMatchContext):boolean {
 return context.evidence.some(evidence=>{
  if(evidence.kind!=="workspace-catalog"||evidence.values.truncated!==false||!Array.isArray(evidence.values.files))return false;
  const windows=evidence.values.platform==="windows";
  if(!windows&&evidence.values.platform!=="posix")return false;
  const files=(evidence.values.files as readonly unknown[]).map(value=>typeof value==="string"?value:value&&typeof value==="object"&&"workspacePath" in value&&typeof value.workspacePath==="string"?value.workspacePath:"").filter(Boolean).map(path=>windows?path.replaceAll("\\","/").toLowerCase():path);
  const wrapper=files.includes(windows?"gradlew.bat":"gradlew");
  const gradle=files.some(path=>["build.gradle","build.gradle.kts","settings.gradle","settings.gradle.kts","gradle/wrapper/gradle-wrapper.properties"].includes(path));
  return wrapper&&gradle&&files.some(path=>windows?path==="src/main/androidmanifest.xml"||path.endsWith("/src/main/androidmanifest.xml"):path==="src/main/AndroidManifest.xml"||path.endsWith("/src/main/AndroidManifest.xml"));
 });
}
