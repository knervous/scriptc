// mbrun.mjs <dir> <file.js|file.wasm> <op> <reps> [count=1000] [warm=20]: one op of the GC micro-bench, JSON line
// with ms, allocated bytes and GC (PerformanceObserver) per op, and the checksum.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { pathToFileURL } from 'node:url';
import { PerformanceObserver } from 'node:perf_hooks';
const [dirA, file, opA, repsA, countA = '1000', warmA = '20'] = process.argv.slice(2);
const dir = path.resolve(dirA), reps = +repsA, count = +countA, warm = +warmA;
const { OPS } = await import(pathToFileURL(path.join(dir, 'gcbench.js')));
const op = /^\d+$/.test(opA) ? +opA : OPS.indexOf(opA);
let api;
if (file.endsWith('.js')) api = await import(pathToFileURL(path.join(dir, file)));
else { const { instantiateWasmGc } = await import(pathToFileURL(path.join(dir, 'host.js'))); const m = await instantiateWasmGc(fs.readFileSync(path.join(dir, file)), { onUncaught: (e) => { throw e; } }); await m.main(); api = m.instance.exports; }
api.setup(count); if (warm) api.run(op, warm);
const gcs = []; let on = true;
new PerformanceObserver(l => { for (const e of l.getEntries()) if (on) gcs.push([e.detail?.kind, e.duration]); }).observe({ entryTypes: ['gc'] });
const a0 = v8.getHeapStatistics().total_allocated_bytes, t0 = performance.now();
const check = api.run(op, reps);
const ms = performance.now() - t0, a1 = v8.getHeapStatistics().total_allocated_bytes;
await new Promise(r => setTimeout(r, 10)); on = false;
const scav = gcs.filter(g => g[0] === 1), mc = gcs.filter(g => g[0] === 4);
console.log(JSON.stringify({ file, op: OPS[op], reps, usPerOp: +(1000 * ms / reps).toFixed(2), allocKBPerOp: +((a1 - a0) / reps / 1024).toFixed(1),
  scavPerOp: +(scav.length / reps).toFixed(3), scavUsPerOp: +(1000 * scav.reduce((s, g) => s + g[1], 0) / reps).toFixed(2), mcUsPerOp: +(1000 * mc.reduce((s, g) => s + g[1], 0) / reps).toFixed(2),
  gcShare: +(gcs.reduce((s, g) => s + g[1], 0) / ms).toFixed(3), check }));
