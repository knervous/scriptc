// The browser lane (docs/capabilities.md §4.6), the page half of chromium.mjs: what this engine and page offer, then
// every probe module under every strings mode, checked as lane.mjs checks it under Node. A module whose recorded
// requirements the engine meets must print exactly its golden output; one it does not meet must be refused, naming
// what is missing.
import { instantiateWasmGc, detectCapabilities, requiredCapabilities, deploymentCapabilities } from "/dist/backend/wasmgc/host.js";
import { SOFT_REQUIREMENTS } from "/dist/backend/wasmgc/capabilities.js";
import { createTaskRing } from "/dist/backend/wasmgc/task-ring.js";
import { runner, script } from "./ring-script.js";

const MODES = ["auto", "engine", "constants", "polyfill"];
const engine = detectCapabilities();
const golden = await (await fetch("/expected.json")).json();
const modules = (new URLSearchParams(location.search).get("mods") ?? "").split(",").filter(Boolean);
globalThis.sink = (u8) => `len=${u8.length} first=${u8[0]}`;

async function runOnce(bytes, strings) {
  const out = [];
  const push = (...a) => out.push(a.map(String).join(" "));
  const inst = await instantiateWasmGc(bytes, { log: push, error: push, strings });
  const pageLog = console.log, pageError = console.error;
  console.log = push; console.error = push;
  try { await inst.main(); await new Promise((r) => setTimeout(r, 5)); } finally { console.log = pageLog; console.error = pageError; inst.stopTimers(); }
  return { out: out.join("\n"), fallbacks: inst.capabilities.fallbacks };
}

const rows = [];
let failures = 0;
for (const file of modules) {
  const bytes = new Uint8Array(await (await fetch(`/out/${file}`)).arrayBuffer());
  const required = requiredCapabilities(bytes);
  for (const strings of MODES) {
    const missing = (required?.requires ?? []).filter((r) => (strings === "engine" || !SOFT_REQUIREMENTS.has(r)) && !engine[r]);
    let verdict;
    try {
      const r = await runOnce(bytes, strings);
      verdict = missing.length ? `FAIL: ran, but this engine lacks ${missing.join(", ")}`
        : r.out !== golden[file] ? `FAIL: output differs: ${JSON.stringify(r.out).slice(0, 200)}`
        : `ok${r.fallbacks.length ? ` [${r.fallbacks.join(", ")}]` : ""}`;
    } catch (e) {
      const message = String(e?.message ?? e);
      verdict = missing.length && /this module requires|this host lacks|this engine lacks/.test(message) ? `refused (${missing.join(", ")})` : `FAIL: ${message.slice(0, 200)}`;
    }
    if (verdict.startsWith("FAIL")) failures++;
    rows.push(`${file} ${strings}: ${verdict}`);
  }
}
// threads=auto: a consumer Worker when the page can share memory, else the owner's thread; the log is the same.
let ring;
try {
  let exited;
  const r = createTaskRing({ threads: "auto", run: runner, slots: 4, payloadBytes: 1024, startConsumer: (buffer, byteOffset, layout) => {
    const worker = new Worker(new URL("./ring-worker.js", import.meta.url), { type: "module" });
    exited = new Promise((resolve) => { worker.onmessage = (e) => { if (e.data === "exited") { worker.terminate(); resolve(); } }; });
    worker.postMessage({ buffer, byteOffset, layout });
  } });
  const log = await script(r);
  if (exited) await exited;
  ring = { threads: r.threads, consumerState: r.consumerState(), log };
} catch (e) { ring = { error: String(e?.message ?? e) }; failures++; }
window.__result = { userAgent: navigator.userAgent, engine, deployment: deploymentCapabilities(), rows, ring, failures };
