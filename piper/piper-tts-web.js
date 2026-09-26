class o {
  type = null;
  data = null;
  constructor(e, t = null) {
    this.type = e, this.data = t;
  }
}
function h(n) {
  return new Worker(
    "" + new URL("worker/OnnxWebWorker.js", import.meta.url).href,
    {
      type: "module",
      name: n?.name
    }
  );
}
class p {
  #e = null;
  constructor({ worker: e = new h(), basePath: t = "/onnx/", numThreads: s = navigator.hardwareConcurrency } = {}) {
    this.#e = e, this.#e.postMessage(new o("constructor", { basePath: t, numThreads: s }));
  }
  destroy() {
    this.#e.postMessage(new o("destroy")), this.#e.terminate();
  }
  async loadSession(e) {
    return this.#e.postMessage(new o("loadSession", [e])), new Promise((t) => this.#e.onmessage = ({ data: s }) => t(s));
  }
  async generate(e, t, s = 0) {
    return this.#e.postMessage(new o("generate", [e, t, s])), new Promise((r) => this.#e.onmessage = ({ data: a }) => r(a));
  }
}
class i {
  #e = [];
  destroy() {
    for (const e in this.#e)
      typeof e == "string" && e.startsWith("blob:") && URL.revokeObjectURL(e);
    this.#e = [];
  }
  async fetch(e) {
    return this.#e[e] ? Promise.resolve(this.#e[e]) : fetch(e).then(async (t) => {
      if (!t.ok)
        throw new Error("Could not fetch: " + e);
      return e.endsWith(".json") ? t.json() : URL.createObjectURL(await t.blob());
    }).then((t) => this.#e[e] = t);
  }
}
function c(n) {
  return new Worker(
    "" + new URL("worker/PhonemizeWebWorker.js", import.meta.url).href,
    {
      type: "module",
      name: n?.name
    }
  );
}
class u {
  #e = null;
  #s = null;
  #t = null;
  constructor({ provider: e = new i(), basePath: t = "/piper/" } = {}) {
    this.#e = e, this.#s = t, this.#t = new c(), this.#t.postMessage(new o("constructor", { provider: e, basePath: t }));
  }
  destroy() {
    this.#e.destroy(), this.#t.postMessage(new o("destroy")), this.#t.terminate();
  }
  async loadModule(e = null, t = null) {
    return e = e || await this.#e.fetch(this.#s + "piper_phonemize.wasm"), t = t || await this.#e.fetch(this.#s + "piper_phonemize.data"), this.#t.postMessage(new o("loadModule", [e, t])), new Promise((s) => this.#t.onmessage = ({ data: r }) => s(r));
  }
  async phonemize(e, t) {
    return await this.loadModule(), this.#t.postMessage(new o("phonemize", [e, t])), new Promise((s) => this.#t.onmessage = ({ data: r }) => s(r));
  }
}
class l {
  #e = null;
  #s = null;
  #t = null;
  constructor({ provider: e = new i(), baseUrl: t = "/piper/models/", separator: s = "-" } = {}) {
    this.#e = e, this.#s = t, this.#t = s;
  }
  destroy() {
    this.#e.destroy();
  }
  async list() {
    return this.#e.fetch(this.#s + "voices.json");
  }
  async fetch(e) {
    const t = e.split(this.#t), s = this.#s + t[0].split("_")[0] + "/" + t.join("/") + "/" + t.join("-");
    return Promise.all([s + ".onnx.json", s + ".onnx"].map((r) => this.#e.fetch(r)));
  }
}
class m extends l {
  constructor({
    provider: e = new i(),
    baseUrl: t = "https://huggingface.co/rhasspy/piper-voices/resolve/main/",
    separator: s = "-"
  } = {}) {
    super({ provider: e, baseUrl: t, separator: s });
  }
}
export {
  m as HuggingFaceVoiceProvider,
  p as OnnxWebWorkerRuntime,
  u as PhonemizeWebWorkerRuntime
};
