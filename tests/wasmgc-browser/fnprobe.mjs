// Function-entry census for a NAMED WasmGC binary (dev builds always carry
// names; release needs SCRIPTC_WASMGC_NAMED=1). It answers "did this run go
// through the fast path", which an output-only differential gate cannot:
// a fast path that is emitted but never taken still prints the right answer.
//
//   node fnprobe.mjs instrument <in.wasm> <out.wasm> [regex]
//     Copies <in.wasm> with a call to probe.hit(id) at the entry of every
//     defined function whose name matches [regex] (default: all), and writes
//     <out.wasm>.probe.json (id -> name).
//   node --import ./fnprobe.mjs <runner> <out.wasm> ...
//     As a preload: supplies the "probe" import to every instantiation and,
//     at exit, writes the entry counts to $FNPROBE_OUT (or prints them).
//     Counts are reset by globalThis.__fnprobeReset() (e.g. after warm-up).
//
// Use dev builds for exact counts: release inlining removes entries.
// The census perturbs timing; never time an instrumented binary.
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FEATURES_OF = (b) => b.Features.GC | b.Features.ReferenceTypes | b.Features.ExceptionHandling | b.Features.BulkMemory | b.Features.SignExt
  | b.Features.NontrappingFPToInt | b.Features.Multivalue | b.Features.TailCall | b.Features.MutableGlobals | b.Features.SIMD128
  | b.Features.BulkMemoryOpt | b.Features.Atomics | b.Features.RelaxedSIMD | b.Features.ExtendedConst;

/** Instrument `bytes`; returns { bytes, names } (names[id] = function name). */
export async function instrument(bytes, pattern = /./) {
  const { default: binaryen } = await import("../../packages/compiler/node_modules/binaryen/index.js");
  // readBinary takes the feature set as a second argument (not in index.d.ts).
  const m = binaryen.readBinary(bytes, FEATURES_OF(binaryen));
  m.addFunctionImport("$fnprobe.hit", "probe", "hit", binaryen.i32, binaryen.none);
  const names = [];
  for (let i = 0; i < m.getNumFunctions(); i++) {
    const f = m.getFunctionByIndex(i), info = binaryen.getFunctionInfo(f);
    if (info.module || !info.body || !pattern.test(info.name)) continue;
    const id = names.length; names.push(info.name);
    binaryen._BinaryenFunctionSetBody(f, m.block(null, [m.call("$fnprobe.hit", [m.i32.const(id)], binaryen.none), info.body], info.results));
  }
  binaryen.setDebugInfo(true);
  try { return { bytes: m.emitBinary(), names }; } finally { binaryen.setDebugInfo(false); m.dispose(); }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMain && process.argv[2] === "instrument") {
  const [, , , input, output, regex] = process.argv;
  const { bytes, names } = await instrument(fs.readFileSync(input), new RegExp(regex ?? "."));
  fs.writeFileSync(output, bytes);
  fs.writeFileSync(output + ".probe.json", JSON.stringify(names));
  console.log(`instrumented ${names.length} functions -> ${output}`);
} else if (!isMain && process.execArgv.some((a) => a.includes("fnprobe.mjs"))) {
  // Preload (node --import .../fnprobe.mjs): provide probe.hit and report at exit.
  // Imported as a library (the gate's instrument()), it installs nothing.
  const counts = new Map();
  let names = null;
  globalThis.__fnprobeReset = () => counts.clear();
  globalThis.__fnprobeCounts = () => Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => [names?.[id] ?? `#${id}`, n]));
  const hit = (id) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const real = WebAssembly.instantiate;
  WebAssembly.instantiate = function (source, imports = {}, ...rest) {
    if (!names) {
      const map = process.env.FNPROBE_MAP ?? process.argv.find((a) => a.endsWith(".wasm")) + ".probe.json";
      try { names = JSON.parse(fs.readFileSync(map, "utf8")); } catch { names = null; }
    }
    return real.call(WebAssembly, source, { ...imports, probe: { hit } }, ...rest);
  };
  process.on("exit", () => {
    const out = JSON.stringify(globalThis.__fnprobeCounts());
    if (process.env.FNPROBE_OUT) fs.writeFileSync(process.env.FNPROBE_OUT, out); else process.stderr.write(`FNPROBE ${out}\n`);
  });
}
