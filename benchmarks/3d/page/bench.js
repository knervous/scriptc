// One lane per page: `?lane=js&js=<url>` loads a JavaScript build, `?lane=wasm&wasm=<url>&host=<url>` a WasmGC build,
// with `modules=<url>` for the npm packages it leaves as JavaScript. `count=1` counts the host imports called (timings
// are then not meaningful). The runner (../run.mjs) calls window.bench.* through Playwright.
const params = new URLSearchParams(location.search);
const counts = new Map();
let counting = false;

async function load() {
  if (params.get("lane") === "js") return await import(params.get("js"));
  const { instantiateWasmGc } = await import(params.get("host"));
  const bytes = new Uint8Array(await (await fetch(params.get("wasm"))).arrayBuffer());
  const modules = params.get("modules") ? (await import(params.get("modules"))).modules : undefined;
  if (params.get("count") === "1") {
    // Each import table wrapped in a copy (an npm package's module namespace cannot be written).
    const instantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = (mod, imports) => {
      WebAssembly.instantiate = instantiate;
      for (const [ns, table] of Object.entries(imports ?? {})) {
        if (ns === "'" || typeof table !== "object" || table === null) continue;
        const copy = {};
        for (const [k, f] of Object.entries(table)) {
          if (typeof f !== "function") { copy[k] = f; continue; }
          const key = `${ns}.${k}`;
          copy[k] = function (...a) { if (counting) counts.set(key, (counts.get(key) ?? 0) + 1); return f.apply(this, a); };
        }
        imports[ns] = copy;
      }
      return instantiate.call(WebAssembly, mod, imports);
    };
  }
  const m = await instantiateWasmGc(bytes, { error: (...a) => console.error(...a), ...(modules ? { modules } : {}) });
  await m.main();
  return m.instance.exports;
}

const app = await load();
const canvas = document.getElementById("scene");
window.bench = {
  /** Builds the scene with `n` meshes: a JavaScript build's setup may answer a promise, a WasmGC build's says when it
   * is done through ready() (1, or -1 after a failure it logged). */
  async setup(n) {
    await app.setup(params.get("lane") === "js" ? canvas : "scene", n);
    if (typeof app.ready === "function") {
      while (app.ready() === 0) await new Promise((r) => setTimeout(r, 10));
      if (app.ready() < 0) throw new Error("setup failed");
    }
  },
  /** `warmup` untimed frames, then `frames` timed ones: each frame's script time, the last checksum, and host calls. */
  run(warmup, frames) {
    let t = 0, checksum = 0;
    for (let i = 0; i < warmup; i++) checksum = app.frame((t += 16));
    counts.clear();
    counting = true;
    const times = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      checksum = app.frame((t += 16));
      times.push(performance.now() - t0);
    }
    counting = false;
    return { times, checksum, calls: Object.fromEntries(counts) };
  },
  /** The WebGL renderer behind the page (unmasked where the browser allows it). */
  webgl: () => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  },
};
window.__ready = true;
