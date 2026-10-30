import {ANDROID_PROFILE,isAndroidWorkspace} from "./android-profile.ts";
import type {
  SdkInstallablePluginPackageManifest,
  SdkLanguageServiceContribution,
  SdkPluginActivationContext,
  SdkPluginMatchContext,
  SdkPluginModule,
} from "@asterlyn/plugin-sdk";

export const LSP_PLUGIN_ID = "dev.asterlyn.lsp";
export const RUST_LANGUAGE_SERVICE_ID = "rust";
export const TYPESCRIPT_LANGUAGE_SERVICE_ID = "typescript-javascript";

const languageService: SdkLanguageServiceContribution = Object.freeze({
  kind: "language-service",
  id: TYPESCRIPT_LANGUAGE_SERVICE_ID,
  label: "TypeScript / JavaScript",
  serverId: "typescript",
  languageIds: Object.freeze(["typescript", "typescriptreact", "javascript", "javascriptreact"]),
  extensions: Object.freeze([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]),
  rootMarkers: Object.freeze(["tsconfig.json", "jsconfig.json", "package.json"]),
});

const rustService: SdkLanguageServiceContribution = Object.freeze({
  kind: "language-service", id: RUST_LANGUAGE_SERVICE_ID, label: "Rust",
  serverId: "rust-analyzer", languageIds: Object.freeze(["rust"]),
  extensions: Object.freeze([".rs"]), rootMarkers: Object.freeze(["Cargo.toml"]),
});

export const LSP_PLUGIN_MANIFEST: SdkInstallablePluginPackageManifest = Object.freeze({
  schemaVersion: 3,
  sdkMajor: 1,
  id: LSP_PLUGIN_ID,
  version: "0.3.8",
  nameKey: "name",
  descriptionKey: "description",
  localization: Object.freeze({
    defaultLocale: "en-US",
    locales: Object.freeze({
      "en-US": Object.freeze({
        name: "Language services",
        description: "TypeScript, JavaScript, Rust and Android Java/Kotlin language services.",
      }),
      "zh-CN": Object.freeze({
        name: "语言服务",
        description: "TypeScript、JavaScript、Rust 和 Android Java/Kotlin 语言服务。",
      }),
    }),
  }),
  settings: Object.freeze([]),
  capabilities: Object.freeze(["languageServices", "pluginDependencies", "packagedLanguageServices"]),
  dependencies: Object.freeze([Object.freeze({ id: "dev.asterlyn.android-gradle", minimum: "0.6.3", maximumExclusive: "1.0.0" })]),
  permissions: Object.freeze(["host.language-services.execute"]),
  languageServers: Object.freeze([ANDROID_PROFILE]),
  distribution: Object.freeze({
    repository: "guozhiqiang123/asterlyn-plugin-lsp",
    runtime: Object.freeze({ protocol: 1, entry: "runtime/plugin.js" }),
    hostCompatibility: Object.freeze({ minimum: "0.1.22", maximumExclusive: "0.2.0" }),
    license: Object.freeze({ expression: "MIT", file: "LICENSE" }),
    integrity: Object.freeze({}),
  }),
});

/** Empty evidence is intentionally eligible so the first opened supported file can activate the service. */
export function matchesLanguageWorkspace(_context: SdkPluginMatchContext): boolean {
  return true;
}

export const LSP_PLUGIN: SdkPluginModule = Object.freeze({
  sdkMajor: 1,
  id: LSP_PLUGIN_ID,
  version: LSP_PLUGIN_MANIFEST.version,
  manifest: LSP_PLUGIN_MANIFEST,
  matches: matchesLanguageWorkspace,
  activate: (context: SdkPluginActivationContext) => {
    const {contribute}=context;
    const contributions = [contribute(languageService), contribute(rustService)];
    if(isAndroidWorkspace(context))contributions.push(contribute({kind:"language-service",id:"android-jvm",label:"Android Java / Kotlin",serverId:ANDROID_PROFILE.id,languageIds:["java","kotlin"],extensions:[".java",".kt"],rootMarkers:["settings.gradle","settings.gradle.kts","build.gradle","build.gradle.kts"]}));
    return Object.freeze({ dispose: () => contributions.forEach((item) => item.dispose()) });
  },
});

