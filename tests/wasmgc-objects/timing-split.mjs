// Where a compile's time goes (docs-draft/OBJECT_FILES_POC.md): reads a build's SCRIPTC_TIMING=1 stderr and splits it
// into the frontend (program load and TypeScript check, lowering, IR validation), backend emission (every wasmgc.*
// phase before optimisation) and the optimizer (wasmgc.optimisation: wasm-opt).
//
//   SCRIPTC_TIMING=1 node <build> 2> timing.log; node timing-split.mjs timing.log
import fs from "node:fs";

const text = fs.readFileSync(process.argv[2], "utf8");
const split = { frontendLoad: 0, lower: 0, irValidate: 0, emit: 0, optimise: 0 };
const emitPhases = new Map();
for (const line of text.split("\n")) {
  const m = /^scriptc timing (\{.*\})$/.exec(line.trim());
  if (!m) continue;
  const e = JSON.parse(m[1]);
  const ms = Number(e.phase_ms) || 0;
  if (e.phase === "frontend-load") split.frontendLoad += ms;
  else if (e.phase === "lower") split.lower += ms;
  else if (e.phase === "ir-validate") split.irValidate += ms;
  else if (e.phase === "wasmgc.optimisation") split.optimise += ms;
  else if (e.phase.startsWith("wasmgc.")) {
    split.emit += ms;
    const key = e.phase.startsWith("wasmgc.function ") ? "wasmgc.function (all)" : e.phase;
    emitPhases.set(key, (emitPhases.get(key) ?? 0) + ms);
  }
}
const total = Object.values(split).reduce((a, b) => a + b, 0);
const s = (ms) => `${(ms / 1000).toFixed(1)} s (${((100 * ms) / total).toFixed(0)}%)`;
console.log(JSON.stringify({
  totalS: +(total / 1000).toFixed(1),
  frontend: s(split.frontendLoad + split.lower + split.irValidate), frontendLoad: s(split.frontendLoad), lower: s(split.lower), irValidate: s(split.irValidate),
  emit: s(split.emit), optimise: s(split.optimise),
  topEmitPhases: [...emitPhases].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}: ${(v / 1000).toFixed(1)} s`),
}, null, 2));
