import { cp, mkdir, readFile, readdir, stat, writeFile, lstat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RpcPeer } from "./rpc.mjs";

const MAX_FILES = 100000;
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
    if (++counter.count > MAX_FILES) throw new Error("kotlin-source-file-bound");
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = join(target, entry.name);
      if (entry.isDirectory()) await visit(from, to);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        await cp(from, to);
        const original = resolve(from);
        const privatePath = resolve(to);
        mappings.originalToPrivate.set(original, privatePath);
        mappings.privateToOriginal.set(privatePath, original);
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
    const exact = table.get(path);
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
  const shadowRoot = join(state, "kotlin-source-view");
  const configRoot = join(state, "kotlin-config");
  await mkdir(shadowRoot, { recursive: true });
  const mappings = { originalToPrivate: new Map(), privateToOriginal: new Map() };
  const counter = { count: 0 };
  const modules = modelModules(model);
  const classpath = [];
  for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
    const module = modules[moduleIndex];
    const moduleRoot = join(shadowRoot, `module-${moduleIndex}`);
    for (let sourceIndex = 0; sourceIndex < module.sources.length; sourceIndex++) {
      const sourceRoot = resolve(module.sources[sourceIndex]);
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
  const javaPath = asPath(java);
  configuration.onStart?.({ javaPath, runtimeClasspath: runtimeClasspath.split(delimiter).length, lib: layout.lib });
  const env = { HOME: process.env.HOME ?? state, TMPDIR: process.env.TMPDIR ?? "/tmp", PATH: `${dirname(javaPath)}:/usr/bin:/bin`, JAVA_HOME: resolve(dirname(dirname(javaPath))), XDG_CONFIG_HOME: configRoot };
  const child = spawn(javaPath, ["-Xmx2G", "-cp", runtimeClasspath, "org.javacs.kt.MainKt"], { cwd: shadowRoot, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
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
  const rootUri = uriFor(shadowRoot);
  await upstream.request("initialize", {
    processId: null,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "Asterlyn Android model" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceFolders: true, applyEdit: false }, window: { workDoneProgress: true }, textDocument: { definition: { linkSupport: false }, hover: { contentFormat: ["plaintext", "markdown"] }, publishDiagnostics: { versionSupport: true } } },
    initializationOptions: { settings: configuration.settings ?? {}, workspaceFolders: [rootUri], bundles: [], extendedClientCapabilities: {} },
  }, 90000);
  upstream.notify("initialized", {});
  const overlayEntries = overlays instanceof Map ? [...overlays.entries()] : Object.entries(overlays);
  for (const [original, overlay] of overlayEntries) {
    const originalPath = uriPath(original) ?? resolve(original);
    const privatePath = mappings.originalToPrivate.get(originalPath);
    if (!privatePath) continue;
    await writeFile(privatePath, String(overlay.text ?? ""));
    // Java is part of the private classpath/source view only. Kotlin LSP tracks Kotlin documents;
    // the host's Java service owns Java didOpen/didChange notifications.
    if (extname(privatePath) === ".java") continue;
    if (extname(privatePath) !== ".kt" && extname(privatePath) !== ".kts") continue;
    upstream.notify("textDocument/didOpen", { textDocument: { uri: uriFor(privatePath), languageId: extname(privatePath) === ".kts" ? "kotlin" : "kotlin", version: Number(overlay.version ?? 1), text: String(overlay.text ?? "") } });
  }
  const close = async () => {
    upstream.close();
    if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    if (child.exitCode !== null) return;
    await new Promise((resolveClose) => child.once("exit", resolveClose));
  };
  return { peer, close, distributionRoot: layout.root, privateRoot: shadowRoot, classpath: uniqueClasspath };
}

export default { startKotlin };
