// The blur app's thread lanes (RESULTS.md, Threads), all running the same kernel and printing the same image hash:
//   js (median), js+fallback (median)  baseline.ts and main.ts again: the table's single-threaded references
//   js 4 workers                   node workers.ts 4: worker_threads over SharedArrayBuffers
//   js threads=off (task ring)     node threads.ts: createTaskRing's owner-thread drain
//   wasmgc threads=shared N        shared.ts compiled to WasmGC on a shared link memory, one instance per
//                                  worker_thread (shared-run.mjs), N = 1, 2, 4
//   wasmgc threads=shared chromium N  the same module in headless Chromium, cross-origin isolated, one module
//                                  Worker per thread (browser-run.mjs; needs Playwright)
//   native threads N               shared.ts built as a thread-instanced library (native-shared.json), driven by
//                                  native-host.c: N pthreads, one runtime instance each, N = 1, 2, 4 (needs clang)
// Thread timings vary more than single-threaded ones: each lane runs RUNS times and records the median.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RUNS = 3, COUNTS = [1, 2, 4];
const EXPORTS = ["fill", "reset", "work", "checksum"];

export default async function ({ repo, dir, noNative }) {
  const dist = path.join(repo, "packages/compiler/dist");
  const { compile, compileLibrary } = await import(pathToFileURL(path.join(dist, "index.js")).href);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "intrinsics-blur-threads-"));
  const run = (cmd, argv, note, extra = {}) => {
    const outs = [];
    let said = "";
    for (let i = 0; i < RUNS; i++) {
      const r = spawnSync(cmd, argv, { encoding: "utf8", cwd: dir, maxBuffer: 1 << 26 });
      if (r.status !== 0) return { error: (r.stderr || r.stdout).slice(0, 300) };
      outs.push(r.stdout);
      said = r.stderr.trim();
    }
    if (said) note = `${note} (${said})`;
    const time = (o) => Number(o.match(/^time (\S+)/m)[1]);
    const sorted = [...outs].sort((a, b) => time(a) - time(b));
    return { stdout: sorted[Math.floor(RUNS / 2)], note, runs: outs.map(time), ...extra };
  };
  const lanes = {};
  // The Threads table's single-threaded references, with the same runs and median as the thread lanes.
  lanes["js (median)"] = run(process.execPath, [path.join(dir, "baseline.ts")], "baseline.ts, the js lane's program");
  lanes["js+fallback (median)"] = run(process.execPath, [path.join(dir, "main.ts")], "main.ts, the js+fallback lane's program: the thread lanes' kernel");
  lanes["js 4 workers"] = run(process.execPath, [path.join(dir, "workers.ts"), "4"], "4 worker_threads over SharedArrayBuffer, bands claimed from a WorkCounter");
  lanes["js threads=off (task ring)"] = run(process.execPath, [path.join(dir, "threads.ts")], "createTaskRing threads=off: each band published and drained on the owner thread");

  // WasmGC: one module, imported shared memory, link exports taking the buffers as (address, length).
  const wasm = path.join(work, "shared.wasm");
  const t = performance.now();
  const r = await compile(path.join(dir, "shared.ts"), { outputKind: "wasmgc", outDir: work, outPath: wasm, release: true, capabilities: "threads=shared",
    wasmLink: { namespace: "blur", exports: EXPORTS, memory: { module: "env", name: "memory", shared: true } } });
  if (!r.ok) {
    const error = r.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ").slice(0, 400);
    for (const n of COUNTS) lanes[`wasmgc threads=shared ${n}`] = { error };
  } else {
    const built = { bytes: fs.statSync(wasm).size, compileMs: performance.now() - t, capabilities: r.artifact.capabilities.key, explainCapabilities: r.artifact.explainCapabilities };
    const host = pathToFileURL(path.join(dist, "backend/wasmgc/host.js")).href;
    for (const n of COUNTS) lanes[`wasmgc threads=shared ${n}`] = run(process.execPath, [path.join(dir, "shared-run.mjs"), wasm, String(n), host],
      `${n} worker_threads, one instance each on one shared WebAssembly.Memory`, built);
    let playwright = true;
    try { createRequire(path.join(dir, "browser-run.mjs")).resolve("playwright"); } catch { playwright = false; }
    for (const n of COUNTS) lanes[`wasmgc threads=shared chromium ${n}`] = playwright
      ? run(process.execPath, [path.join(dir, "browser-run.mjs"), work, String(n), dist], `headless Chromium, cross-origin isolated, ${n} module Workers`, built)
      : { error: "Playwright is not resolvable (NODE_PATH)" };
  }

  if (!noNative) {
    // shared.ts as a thread-instanced library (native-shared.json) and native-host.c, its pthreads host.
    const t = performance.now();
    const profile = JSON.parse(fs.readFileSync(path.join(dir, "native-shared.json"), "utf8"));
    profile.entry = path.join(dir, profile.entry);
    fs.writeFileSync(path.join(work, "profile.json"), JSON.stringify(profile));
    const lib = await compileLibrary({ profilePath: path.join(work, "profile.json"), outDir: work });
    const exe = path.join(work, "native-host");
    const cc = lib.ok ? spawnSync(process.env.CC ?? "clang", ["-std=c11", "-O2", "-pthread", path.join(dir, "native-host.c"), lib.archivePath, "-lm", "-o", exe], { encoding: "utf8" }) : null;
    const error = !lib.ok ? lib.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ").slice(0, 400) : cc.status !== 0 ? `cc: ${cc.stderr.slice(0, 300)}` : null;
    for (const c of COUNTS) lanes[`native threads ${c}`] = error ? { error }
      : run(exe, [String(c)], `shared.ts as a thread-instanced library: ${c} pthreads, one runtime instance each, on this host's buffers`, { bytes: fs.statSync(exe).size, compileMs: performance.now() - t });
  }
  fs.rmSync(work, { recursive: true, force: true });
  return lanes;
}
