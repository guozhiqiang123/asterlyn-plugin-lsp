import { cp, mkdir, readFile, readdir, stat, writeFile, lstat, realpath, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RpcPeer } from "./rpc.mjs";

const MAX_SOURCE_FILES = 20000;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 100000;
const SOURCE_EXTENSIONS = new Set([".kt", ".kts", ".java"]);

const asPath = (value) => value instanceof URL ? fileURLToPath(value) : resolve(String(value));
const isInside = (root, value) => value === root || value.startsWith(`${root}${sep}`);
const uriPath = (value) => {
  if (typeof value !== "string" || !value.startsWith("file:")) return null;
  try { return resolve(fileURLToPath(value)); } catch { return null; }
};
const uriFor = (value) => pathToFileURL(value).href;
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

async function copySources(sourceRoot, destination, mappings, counter) {
  const info = await lstat(sourceRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("kotlin-source-root-invalid");
  const visit = async (source, target) => {
    if (++counter.entries > MAX_DIRECTORY_ENTRIES) throw new Error("kotlin-source-entry-bound");
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = join(target, entry.name);
      if (entry.isDirectory()) await visit(from, to);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        const metadata = await stat(from);
        if (metadata.size > MAX_SOURCE_FILE_BYTES || counter.files >= MAX_SOURCE_FILES || counter.bytes > MAX_SOURCE_BYTES - metadata.size) throw new Error("kotlin-source-size-bound");
        await cp(from, to);
        counter.files++;
        counter.bytes += metadata.size;
        const original = await realpath(from);
        const privatePath = resolve(to);
        mappings.originalToPrivate.set(original, privatePath);
        mappings.originalToPrivate.set(original.toLowerCase(), privatePath);
        mappings.privateToOriginal.set(privatePath, original);
        mappings.privateToOriginal.set(privatePath.toLowerCase(), original);
      }
    }
  };
  await visit(sourceRoot, destination);
}

function modelModules(model) {
  if (!model || model.schemaVersion !== 1 || !Array.isArray(model.modules) || model.modules.length === 0) throw new Error("kotlin-model-invalid");
  return model.modules.filter((module) => module && typeof module.directory === "string" && Array.isArray(module.sources));
}

async function componentLayout(component) {
  const supplied = asPath(component.distributionRoot ?? component.root ?? component);
  const candidates = [supplied, join(supplied, "server"), join(supplied, "content", "server")];
  for (const root of candidates) {
    const lib = join(root, "lib");
    try {
      await stat(join(lib, "server-1.3.13.jar"));
      return { root, lib };
    } catch {}
  }
  throw new Error("kotlin-component-layout-invalid");
}

async function createClasspathConfig(configRoot, classpath) {
  const directory = join(configRoot, "kotlin-language-server");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "classpath"), `#!/bin/sh\nprintf '%s' ${shellQuote(classpath.join(delimiter))}\n`, { mode: 0o700 });
}

function mapUriFactory(mappings, shadowRoot) {
  const convert = (value, reverse) => {
    const path = uriPath(value);
    if (!path) return value;
    const table = reverse ? mappings.privateToOriginal : mappings.originalToPrivate;
    const exact = table.get(path) ?? table.get(path.toLowerCase());
    return exact ? uriFor(exact) : value;
  };
  const mapObject = (value, reverse, key = "") => {
    if (typeof value === "string") return ["uri", "targetUri", "oldUri", "documentUri"].includes(key) ? convert(value, reverse) : value;
    if (Array.isArray(value)) return value.map((entry) => mapObject(entry, reverse, key));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => {
      const mappedName = reverse && uriPath(name) ? convert(name, true) : name;
      return [mappedName, mapObject(entry, reverse, name)];
    }));
  };
  return {
    input: (value) => mapObject(value, false),
    output: (value) => mapObject(value, true),
    privatePath: (path) => isInside(shadowRoot, path),
  };
}

export async function startKotlin({ model, stateDirectory, java, component, overlays = {}, configuration = {} }) {
  const state = resolve(asPath(stateDirectory));
  await mkdir(state, { recursive: true });
  const generation = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const shadowRoot = join(state, `kotlin-source-view-${generation}`);
  const configRoot = join(state, "kotlin-config");
  await mkdir(shadowRoot, { recursive: true });
  const mappings = { originalToPrivate: new Map(), privateToOriginal: new Map() };
  for (const entry of await readdir(state, { withFileTypes: true })) {
    if (entry.name.startsWith("kotlin-source-view-") && entry.name !== `kotlin-source-view-${generation}`) await rm(join(state, entry.name), { recursive: true, force: true });
  }
  const counter = { entries: 0, files: 0, bytes: 0 };
  const modules = modelModules(model);
  const classpath = [];
  for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
    const module = modules[moduleIndex];
    const moduleRoot = join(shadowRoot, `module-${moduleIndex}`);
    for (let sourceIndex = 0; sourceIndex < module.sources.length; sourceIndex++) {
      const sourceRoot = await realpath(resolve(module.sources[sourceIndex])).catch(() => resolve(module.sources[sourceIndex]));
      try { if ((await stat(sourceRoot)).isDirectory()) await copySources(sourceRoot, join(moduleRoot, `source-${sourceIndex}`), mappings, counter); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    for (const value of [...(module.bootClasspath ?? []), ...(module.compileClasspath ?? [])]) if (typeof value === "string") classpath.push(resolve(value));
  }
  const uniqueClasspath = [...new Set(classpath)];
  await createClasspathConfig(configRoot, uniqueClasspath);
  const layout = await componentLayout(component);
  const jars = (await readdir(layout.lib)).filter((name) => name.endsWith(".jar")).map((name) => join(layout.lib, name));
  const serverJar = join(layout.lib, "server-1.3.13.jar");
  const runtimeClasspath = [serverJar, ...jars.filter((jar) => jar !== serverJar)].join(delimiter);
  const patchJar = component?.patchJar ? resolve(asPath(component.patchJar)) : null;
  const effectiveClasspath = patchJar ? [patchJar, ...jars.filter((jar) => jar !== serverJar)].join(delimiter) : runtimeClasspath;
  const javaPath = asPath(java);
  configuration.onStart?.({ javaPath, runtimeClasspath: effectiveClasspath.split(delimiter).length, lib: layout.lib, patchJar });
  const env = { HOME: process.env.HOME ?? state, TMPDIR: process.env.TMPDIR ?? "/tmp", PATH: `${dirname(javaPath)}:/usr/bin:/bin`, JAVA_HOME: resolve(dirname(dirname(javaPath))), XDG_CONFIG_HOME: configRoot };
  const child = spawn(javaPath, ["-Xmx2G", "-cp", effectiveClasspath, "org.javacs.kt.MainKt"], { cwd: shadowRoot, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", (chunk) => configuration.onStderr?.(String(chunk).slice(0, 4096)));
  const upstream = new RpcPeer(child.stdout, child.stdin);
  const map = mapUriFactory(mappings, shadowRoot);
  const peer = {
    request: (method, params, timeout) => upstream.request(method, map.input(params), timeout).then(map.output),
    notify: (method, params) => upstream.notify(method, map.input(params)),
    reply: (id, result) => upstream.reply(id, map.input(result)),
    reject: (...args) => upstream.reject(...args),
    on: (event, listener) => { upstream.on(event, (message) => listener({ ...message, params: map.output(message.params), result: map.output(message.result) })); return peer; },
    once: (event, listener) => { upstream.once(event, (message) => listener({ ...message, params: map.output(message.params), result: map.output(message.result) })); return peer; },
  };
  const onError = (error) => { if (configuration.onError) configuration.onError(error); };
  upstream.on("fatal", onError).on("closed", () => configuration.onClosed?.());
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    upstream.close();
    if (child.exitCode !== null) return;
    try { child.kill("SIGTERM"); } catch {}
    await new Promise((resolveClose) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolveClose();
      let settled = false;
      const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolveClose(); } };
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} finish(); }, 3000);
      child.once("exit", finish);
    });
  };
  const openKotlin = new Map();
  const overlayState = new Map();
  // fwcd only treats Kotlin files as source roots. A Java shadow-file change
  // therefore needs a cheap Kotlin recompile kick so references observe the
  // new Java ABI without exposing Java documents to KLS.
  const kickKotlinRefresh = () => {
    for (const [privatePath, current] of openKotlin) {
      const version = current.version + 1;
      upstream.notify("textDocument/didChange", {
        textDocument: { uri: uriFor(privatePath), version },
        contentChanges: [{ text: current.text }],
      });
      openKotlin.set(privatePath, { ...current, version });
    }
  };
  const mappedPrivatePath = async (uri) => {
    const value = uriPath(uri) ?? resolve(uri);
    const canonical = await realpath(value).catch(() => resolve(value));
    return mappings.originalToPrivate.get(canonical) ?? mappings.originalToPrivate.get(canonical.toLowerCase());
  };
  const applyOverlay = async (uri, overlay = {}) => {
    const privatePath = await mappedPrivatePath(uri);
    if (!privatePath) throw new Error("kotlin-overlay-outside-model");
    const text = String(overlay.text ?? "");
    if (Buffer.byteLength(text) > MAX_SOURCE_FILE_BYTES) throw new Error("kotlin-overlay-size-bound");
    await writeFile(privatePath, text);
    overlayState.set(privatePath, text);
    if (extname(privatePath) === ".java") {
      upstream.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: uriFor(privatePath), type: 2 }] });
      kickKotlinRefresh();
      return;
    }
    if (extname(privatePath) !== ".kt" && extname(privatePath) !== ".kts") return;
    const prior = openKotlin.get(privatePath);
    const version = Number(overlay.version ?? prior?.version ?? 1);
    if (prior) upstream.notify("textDocument/didChange", { textDocument: { uri: uriFor(privatePath), version }, contentChanges: [{ text }] });
    else upstream.notify("textDocument/didOpen", { textDocument: { uri: uriFor(privatePath), languageId: "kotlin", version, text } });
    openKotlin.set(privatePath, { version, text });
  };
  const closeOverlay = async (uri) => {
    const privatePath = await mappedPrivatePath(uri);
    const originalPath = privatePath && (mappings.privateToOriginal.get(privatePath) ?? mappings.privateToOriginal.get(privatePath.toLowerCase()));
    if (!privatePath || !originalPath) throw new Error("kotlin-overlay-source-missing");
    const text = await readFile(originalPath, "utf8");
    await writeFile(privatePath, text);
    overlayState.delete(privatePath);
    if (extname(privatePath) === ".java") {
      upstream.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: uriFor(privatePath), type: 2 }] });
      kickKotlinRefresh();
    }
    else if (openKotlin.has(privatePath)) {
      const version = openKotlin.get(privatePath).version + 1;
      upstream.notify("textDocument/didChange", { textDocument: { uri: uriFor(privatePath), version }, contentChanges: [{ text }] });
      openKotlin.set(privatePath, { version, text });
    }
  };
  const refreshSources = async () => {
    const changedJava = [];
    const seen = new Set();
    for (const [originalPath, privatePath] of mappings.originalToPrivate) {
      if (seen.has(privatePath) || overlayState.has(privatePath)) continue;
      seen.add(privatePath);
      const text = await readFile(originalPath, "utf8").catch(() => null);
      if (text === null) continue;
      await writeFile(privatePath, text);
      if (extname(privatePath) === ".java") changedJava.push({ uri: uriFor(privatePath), type: 2 });
    }
    if (changedJava.length) {
      upstream.notify("workspace/didChangeWatchedFiles", { changes: changedJava });
      kickKotlinRefresh();
    }
  };
  const rootUri = uriFor(shadowRoot);
  try { await upstream.request("initialize", {
    processId: null,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "Asterlyn Android model" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceFolders: true, applyEdit: false }, window: { workDoneProgress: true }, textDocument: { definition: { linkSupport: false }, hover: { contentFormat: ["plaintext", "markdown"] }, publishDiagnostics: { versionSupport: true } } },
    initializationOptions: { settings: configuration.settings ?? {}, workspaceFolders: [rootUri], bundles: [], extendedClientCapabilities: {} },
  }, 90000);
  upstream.notify("initialized", {});
  const overlayEntries = overlays instanceof Map ? [...overlays.entries()] : Object.entries(overlays);
  for (const [original, overlay] of overlayEntries) {
    await applyOverlay(original, overlay);
  }
  } catch (error) { await close(); throw error; }
  return { peer, close, applyOverlay, closeOverlay, refreshSources, distributionRoot: layout.root, privateRoot: shadowRoot, classpath: uniqueClasspath };
}

export default { startKotlin };
