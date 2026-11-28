// One lane per page: `?lane=js` loads the JavaScript build, `?lane=wasm&wasm=<url>` a WasmGC build (with `host=<url>`
// for its host). The runner (run.mjs) calls window.bench.* through Playwright.
//
// An operation is a click on one of the app's buttons (or row links), so it runs through React's root delegation as a
// person's click would. Its script time ends when React's commit is done (a mutation observer's microtask), and layout
// is timed separately, by forcing it right after (both builds pay it).

const params = new URLSearchParams(location.search);
const lane = params.get("lane") ?? "js";
const counting = params.get("count") === "1";

/** Host-import counters (count=1 only; timings are then not meaningful). */
const counts = new Map();
let countingOn = false;

async function load() {
  if (lane === "js") return await import(params.get("js") ?? "../out/app.js");
  const { instantiateWasmGc } = await import(params.get("host"));
  const bytes = new Uint8Array(await (await fetch(params.get("wasm"))).arrayBuffer());
  const wrapImports = (imports) => {
    for (const [ns, table] of Object.entries(imports ?? {})) {
      if (ns === "'" || typeof table !== "object") continue;
      for (const [k, f] of Object.entries(table)) {
        if (typeof f !== "function" || f.__counted) continue;
        const key = `${ns}.${k}`;
        const counted = function (...a) {
          if (countingOn) counts.set(key, (counts.get(key) ?? 0) + 1);
          return f.apply(this, a);
        };
        counted.__counted = true;
        table[k] = counted;
      }
    }
  };
  if (counting) {
    const inst = WebAssembly.instantiate;
    WebAssembly.instantiate = (mod, imports) => {
      WebAssembly.instantiate = inst;
      wrapImports(imports);
      return inst.call(WebAssembly, mod, imports);
    };
  }
  // stacks=1: the host counts every host call and samples the calling stack of every 257th (host.ts, __scriptcHostStacks).
  if (params.get("stacks")) { globalThis.__scriptcHostCalls = new Map(); globalThis.__scriptcHostStacks = new Map(); }
  let m;
  if (params.get("bridge")) {
    // The DOM bridge: the module's DOM mutations arrive as one stream per commit (packages/dom-stream).
    const { instantiateLinked } = await import(params.get("host"));
    const { createDomHost } = await import(params.get("bridge"));
    let memory;
    const domHost = createDomHost({ memory: () => memory });
    window.__domHost = domHost;
    const imports = domHost.imports;
    if (counting) wrapImports(imports);
    const linked = await instantiateLinked(bytes, { "": { error: (...a) => console.error(...a) } }, imports);
    memory = linked.instance.exports.memory;
    m = { ...linked.modules[""], instance: linked.instance };
  } else m = await instantiateWasmGc(bytes, { error: (...a) => console.error(...a) });
  await m.main();
  window.__wasmExports = m.instance.exports;
  return m.instance.exports;
}

const app = await load();
app.mount("main");

// The end of a click's work: a mutation observer's callback is a microtask queued by the first DOM mutation of
// React's commit (itself in a microtask after the click), so it runs once the commit is done, before any rendering.
let observed = null;
const observer = new MutationObserver(() => { const o = observed; observed = null; if (o) o(performance.now()); });
observer.observe(document.getElementById("main"), { subtree: true, childList: true, attributes: true, characterData: true });
const committed = () => new Promise((resolve) => { observed = resolve; });

const $ = (sel) => document.querySelector(sel);
const rows = () => document.querySelectorAll("tbody > tr");

async function click(el) {
  const done = committed();
  const t0 = performance.now();
  el.click();
  const t1 = await done;
  const t2 = performance.now();
  void document.body.offsetHeight;
  const t3 = performance.now();
  return { script: t1 - t0, layout: t3 - t2 };
}

// Untimed setup clicks wait for a task instead: one that changes nothing (clearing an empty table) mutates nothing.
const channel = new MessageChannel();
let woken = null;
channel.port1.onmessage = () => { const w = woken; woken = null; w(); };
const nextTask = () => new Promise((resolve) => { woken = resolve; channel.port2.postMessage(0); });
const setupClick = async (el) => { el.click(); await nextTask(); };

const button = (id) => async () => click($(`#${id}`));
const setup = (id) => async () => setupClick($(`#${id}`));

/** Each operation: its setup (untimed), the timed step, and a check of the result. */
const OPS = {
  create1k: { setup: [setup("clear")], run: button("run"), check: () => rows().length === 1000 },
  replace1k: { setup: [setup("run")], run: button("run"), check: () => rows().length === 1000 },
  update10th: {
    setup: [setup("run")], run: button("update"),
    check: () => rows()[0].children[1].textContent.endsWith(" !!!") && !rows()[1].children[1].textContent.endsWith(" !!!"),
  },
  select: {
    setup: [setup("run")], run: async () => click(rows()[5].children[1].firstChild),
    check: () => rows()[5].className === "danger" && $("tr.danger") === rows()[5],
  },
  swap: {
    setup: [setup("run")],
    run: async () => { swapWas = rows()[998].children[0].textContent; return click($("#swaprows")); },
    check: () => rows()[1].children[0].textContent === swapWas,
  },
  remove: {
    setup: [setup("run")],
    run: async () => { removeWas = rows()[4].children[0].textContent; return click(rows()[3].children[2].firstChild); },
    check: () => rows().length === 999 && rows()[3].children[0].textContent === removeWas,
  },
  create10k: { setup: [setup("clear")], run: button("runlots"), check: () => rows().length === 10000 },
  append1k: { setup: [setup("clear"), setup("run")], run: button("add"), check: () => rows().length === 2000 },
  clear: { setup: [setup("run")], run: button("clear"), check: () => rows().length === 0 },
  // The mount/update/unmount cycle, five per sample, as the earlier profile batched it.
  cycle: {
    setup: [], run: async () => {
      const t0 = performance.now();
      let ok = 0;
      for (let i = 0; i < 5; i++) ok += app.cycle();
      const t1 = performance.now();
      cycleOk = ok === 15;
      return { script: (t1 - t0) / 5, layout: 0 };
    },
    check: () => cycleOk,
  },
};
let swapWas = "", removeWas = "", cycleOk = false;

/** A fingerprint of the table: its row count and a hash of its text, to compare lanes. */
function fingerprint() {
  const text = $("tbody").textContent;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${rows().length}:${(h >>> 0).toString(16)}:${$("tr.danger")?.children[0].textContent ?? "-"}`;
}

window.bench = {
  lane,
  ops: Object.keys(OPS),
  /** Runs `warmup` untimed and `iterations` timed samples of `name`: its timings, failures and fingerprints. */
  async run(name, warmup, iterations) {
    const op = OPS[name];
    const samples = [], failures = [], prints = [];
    for (let i = 0; i < warmup + iterations; i++) {
      for (const s of op.setup) await s();
      const measured = i >= warmup;
      if (measured && counting) countingOn = true;
      const t = await op.run();
      countingOn = false;
      if (!op.check()) failures.push(i);
      if (measured) { samples.push(t); prints.push(fingerprint()); }
    }
    await setup("clear")();
    return { samples, failures, prints };
  },
  takeCounts() { const out = Object.fromEntries(counts); counts.clear(); return out; },
  /** An operation's setup alone, and its timed step alone (the profiler samples only the step). */
  async setup(name) { for (const s of OPS[name].setup) await s(); },
  async step(name) { const t = await OPS[name].run(); return { ...t, ok: OPS[name].check() }; },
};
window.__ready = true;
