import type {
  SdkInstallablePluginPackageManifest,
  SdkLanguageServiceContribution,
  SdkPluginActivationContext,
  SdkPluginMatchContext,
  SdkPluginModule,
} from "@asterlyn/plugin-sdk";

export const LSP_PLUGIN_ID = "dev.asterlyn.lsp";
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

export const LSP_PLUGIN_MANIFEST: SdkInstallablePluginPackageManifest = Object.freeze({
  schemaVersion: 3,
  sdkMajor: 1,
  id: LSP_PLUGIN_ID,
  version: "0.1.0",
  nameKey: "name",
  descriptionKey: "description",
  localization: Object.freeze({
    defaultLocale: "en-US",
    locales: Object.freeze({
      "en-US": Object.freeze({
        name: "TypeScript and JavaScript language services",
        description: "Diagnostics, hover, definition and basic completion for TypeScript and JavaScript files.",
      }),
      "zh-CN": Object.freeze({
        name: "TypeScript 和 JavaScript 语言服务",
        description: "为 TypeScript 和 JavaScript 文件提供诊断、悬停、定义和基础补全。",
      }),
    }),
  }),
  settings: Object.freeze([]),
  capabilities: Object.freeze(["languageServices"]),
  permissions: Object.freeze(["host.language-services.execute"]),
  distribution: Object.freeze({
    repository: "guozhiqiang123/asterlyn-plugin-lsp",
    runtime: Object.freeze({ protocol: 1, entry: "runtime/plugin.js" }),
    hostCompatibility: Object.freeze({ minimum: "0.1.13", maximumExclusive: "0.2.0" }),
    license: Object.freeze({ expression: "MIT", file: "LICENSE" }),
    integrity: Object.freeze({}),
  }),
});

/** Empty evidence is intentionally eligible so the first opened TS/JS file can activate the service. */
export function matchesLanguageWorkspace(_context: SdkPluginMatchContext): boolean {
  return true;
}

export const LSP_PLUGIN: SdkPluginModule = Object.freeze({
  sdkMajor: 1,
  id: LSP_PLUGIN_ID,
  version: LSP_PLUGIN_MANIFEST.version,
  manifest: LSP_PLUGIN_MANIFEST,
  matches: matchesLanguageWorkspace,
  activate: ({ contribute }: SdkPluginActivationContext) => {
    const contribution = contribute(languageService);
    return Object.freeze({ dispose: () => contribution.dispose() });
  },
});

