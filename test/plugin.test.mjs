import assert from "node:assert/strict";
import test from "node:test";

import {
  LSP_PLUGIN,
  LSP_PLUGIN_ID,
  LSP_PLUGIN_MANIFEST,
  TYPESCRIPT_LANGUAGE_SERVICE_ID,
  matchesLanguageWorkspace,
} from "../src/plugin.ts";

const context = {
  identity: { root: "/workspace", generation: 1 },
  evidence: [],
};

test("identity and schema-3 metadata are stable", () => {
  assert.equal(LSP_PLUGIN.id, LSP_PLUGIN_ID);
  assert.equal(LSP_PLUGIN.version, "0.3.1");
  assert.equal(LSP_PLUGIN_MANIFEST.schemaVersion, 3);
  assert.deepEqual(LSP_PLUGIN_MANIFEST.capabilities, ["languageServices", "pluginDependencies", "packagedLanguageServices"]);
  assert.deepEqual(LSP_PLUGIN_MANIFEST.permissions, ["host.language-services.execute"]);
});

test("empty workspace evidence remains eligible without reading the workspace", () => {
  assert.equal(matchesLanguageWorkspace(context), true);
});

test("activation contributes independent TypeScript and Rust declarations and disposes both", () => {
  const contributions = [];
  let disposed = 0;
  const activation = LSP_PLUGIN.activate({
    ...context,
    taskCache: {},
    contribute: (contribution) => {
      contributions.push(contribution);
      return { dispose: () => { disposed++; } };
    },
  });

  assert.equal(contributions.length, 2);
  assert.equal(contributions[0].kind, "language-service");
  assert.equal(contributions[0].id, TYPESCRIPT_LANGUAGE_SERVICE_ID);
  assert.equal(contributions[0].serverId, "typescript");
  assert.deepEqual(contributions[0].languageIds, ["typescript", "typescriptreact", "javascript", "javascriptreact"]);
  assert.deepEqual(contributions[0].extensions, [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
  assert.deepEqual(contributions[0].rootMarkers, ["tsconfig.json", "jsconfig.json", "package.json"]);
  assert.equal(typeof contributions[0].execute, "undefined");
  assert.deepEqual(contributions[1], { kind: "language-service", id: "rust", label: "Rust", serverId: "rust-analyzer", languageIds: ["rust"], extensions: [".rs"], rootMarkers: ["Cargo.toml"] });
  activation.dispose();
  assert.equal(disposed, 2);
});

test("LSP enablement requires the Android build provider independently of document language", () => {
  assert.deepEqual(LSP_PLUGIN_MANIFEST.dependencies, [{ id: "dev.asterlyn.android-gradle", minimum: "0.6.0", maximumExclusive: "1.0.0" }]);
  assert.ok(Object.isFrozen(LSP_PLUGIN_MANIFEST.dependencies));
});

test("Android contributions require complete Android catalog evidence and never claim scripts",()=>{const contributions=[];const activate=evidence=>LSP_PLUGIN.activate({...context,evidence,taskCache:{},contribute:item=>{contributions.push(item);return{dispose(){}}}});const files=["settings.gradle.kts","build.gradle.kts","gradlew","app/src/main/AndroidManifest.xml"];activate([{kind:"workspace-catalog",values:{platform:"posix",truncated:false,files}}]);assert.deepEqual(contributions.at(-1).languageIds,["java","kotlin"]);assert.deepEqual(contributions.at(-1).extensions,[".java",".kt"]);contributions.length=0;activate([{kind:"workspace-catalog",values:{platform:"posix",truncated:true,files}}]);assert.equal(contributions.length,2);contributions.length=0;activate([{kind:"workspace-catalog",values:{platform:"posix",truncated:false,files:files.slice(0,3)}}]);assert.equal(contributions.length,2);});
