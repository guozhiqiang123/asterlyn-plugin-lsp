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
  assert.equal(LSP_PLUGIN.version, "0.1.0");
  assert.equal(LSP_PLUGIN_MANIFEST.schemaVersion, 3);
  assert.deepEqual(LSP_PLUGIN_MANIFEST.capabilities, ["languageServices"]);
  assert.deepEqual(LSP_PLUGIN_MANIFEST.permissions, ["host.language-services.execute"]);
});

test("empty workspace evidence remains eligible without reading the workspace", () => {
  assert.equal(matchesLanguageWorkspace(context), true);
});

test("activation contributes exactly one plain language declaration and disposes it", () => {
  const contributions = [];
  let disposed = false;
  const activation = LSP_PLUGIN.activate({
    ...context,
    taskCache: {},
    contribute: (contribution) => {
      contributions.push(contribution);
      return { dispose: () => { disposed = true; } };
    },
  });

  assert.equal(contributions.length, 1);
  assert.equal(contributions[0].kind, "language-service");
  assert.equal(contributions[0].id, TYPESCRIPT_LANGUAGE_SERVICE_ID);
  assert.equal(contributions[0].serverId, "typescript");
  assert.deepEqual(contributions[0].languageIds, ["typescript", "typescriptreact", "javascript", "javascriptreact"]);
  assert.deepEqual(contributions[0].extensions, [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
  assert.deepEqual(contributions[0].rootMarkers, ["tsconfig.json", "jsconfig.json", "package.json"]);
  assert.equal(typeof contributions[0].execute, "undefined");
  activation.dispose();
  assert.equal(disposed, true);
});
