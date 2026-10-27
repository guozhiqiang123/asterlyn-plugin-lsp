import { EventEmitter } from "node:events";

const MAX_FRAME = 8 * 1024 * 1024;
export class RpcPeer extends EventEmitter {
  #buffer = Buffer.alloc(0); #sequence = 0; #pending = new Map(); #output;
  constructor(input, output) {
    super(); this.#output = output;
    input.on("data", (chunk) => { try { this.#feed(chunk); } catch { this.emit("fatal", new Error("invalid-language-protocol")); } });
    input.on("end", () => { this.close(); this.emit("closed"); });
    input.on("error", () => { this.close(); this.emit("closed"); });
    output.on("error", () => { this.close(); this.emit("closed"); });
  }
  #feed(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const boundary = this.#buffer.indexOf("\r\n\r\n");
      if (boundary < 0) { if (this.#buffer.length > 8192) throw Error(); return; }
      if (boundary > 8192) throw Error();
      const matches = [...this.#buffer.subarray(0, boundary).toString("ascii").matchAll(/^Content-Length:\s*(\d+)\s*$/gimu)];
      if (matches.length !== 1) throw Error();
      const size = Number(matches[0][1]); if (!Number.isSafeInteger(size) || size < 2 || size > MAX_FRAME) throw Error();
      if (this.#buffer.length < boundary + 4 + size) return;
      const message = JSON.parse(this.#buffer.subarray(boundary + 4, boundary + 4 + size)); this.#buffer = this.#buffer.subarray(boundary + 4 + size);
      if (message.jsonrpc !== "2.0") throw Error();
      if (typeof message.method === "string") this.emit(message.id === undefined ? "notification" : "request", message);
      else {
        const pending = this.#pending.get(message.id); if (!pending) continue;
        this.#pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(Object.assign(new Error("language-request-rejected"), {code: message.error.code})); else pending.resolve(message.result);
      }
    }
  }
  send(value) {
    const body = Buffer.from(JSON.stringify(value)); if (body.length > MAX_FRAME) throw new Error("language-frame-bound");
    if (this.#output.writableLength + body.length > 16 * 1024 * 1024) throw new Error("language-output-queue-bound");
    this.#output.write(`Content-Length: ${body.length}\r\n\r\n`); this.#output.write(body);
  }
  notify(method, params) { this.send({jsonrpc: "2.0", method, params}); }
  reply(id, result) { this.send({jsonrpc: "2.0", id, result}); }
  reject(id, code = -32603, message = "Language operation failed.") { this.send({jsonrpc: "2.0", id, error: {code, message}}); }
  request(method, params, timeout = 30000) {
    if (this.#pending.size >= 64) return Promise.reject(new Error("language-request-bound"));
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); this.notify("$/cancelRequest", {id}); reject(new Error("language-request-timeout")); }, timeout);
      this.#pending.set(id, {resolve, reject, timer}); this.send({jsonrpc: "2.0", id, method, params});
    });
  }
  close() { for (const value of this.#pending.values()) {clearTimeout(value.timer); value.reject(new Error("language-peer-closed"));} this.#pending.clear(); }
}
