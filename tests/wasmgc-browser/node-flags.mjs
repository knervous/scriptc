// Node 24 and 25 carry WebAssembly.Memory.prototype.toResizableBuffer behind a V8 flag (Node 26 ships it), which
// modules that hand typed arrays to JavaScript need. NODE_OPTIONS refuses the flag, so the runners put it on the
// command line of every Node process they start, and a runner started without it reruns itself with it, as
// `scriptw run` does.
import { spawnSync } from "node:child_process";

export const RAB_FLAG = "--experimental-wasm-rab-integration";
const major = Number(process.versions.node.split(".")[0]);

/** The arguments a Node process that runs a compiled module takes before its script on this Node. */
export const wasmNodeArgs = major === 24 || major === 25 ? [RAB_FLAG] : [];

/** Reruns this process with the flag when this Node needs it and was started without it; returns otherwise. */
export function rerunWithWasmFlags() {
  if (typeof WebAssembly.Memory.prototype.toResizableBuffer === "function") return;
  if (wasmNodeArgs.length === 0 || process.execArgv.includes(RAB_FLAG)) return;
  const r = spawnSync(process.execPath, [...wasmNodeArgs, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
