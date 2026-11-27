// gcloop.mjs <stageDir> <file.wasm|file.js> <op> <n> [warm=5] : steady-state GC accounting over n
// back-to-back ops with no checks and no forced GCs (phase-robust: GC lands wherever the nursery fills).
// ops: mount (start+stop cycle), reorder, context, increment, remove (remove+re-add via remount every 8).
// Prints per op: wall ms, GC ms by kind, scavenges, MB allocated. Run with --trace-gc-nvp to get survival.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
const probe = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../react-probe');
const req = createRequire(path.join(probe, 'profile-deps/package.json')); const { JSDOM } = req('jsdom');
const [stageA, file, op, nA, warmA] = process.argv.slice(2); const stage = path.resolve(stageA), n = +nA, warm = +(warmA ?? 5);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLIFrameElement', 'MutationObserver', 'Event', 'MouseEvent', 'CustomEvent'])
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window); globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
const errors = []; globalThis.reportError = e => errors.push(String(e));
let api;
if (file.endsWith('.js')) api = await import(pathToFileURL(path.join(stage, file)));
else { const { instantiateWasmGc } = await import(pathToFileURL(path.join(stage, 'host.js'))); const m = await instantiateWasmGc(fs.readFileSync(path.join(stage, file)), { onUncaught: e => errors.push(String(e)) }); m.main(); api = m.instance.exports; }
const until = async (test) => { let k = 0; while (!test()) { if (errors.length) throw Error(errors.join('\n')); if (++k > 1e6) throw Error('timeout'); await new Promise(r => setImmediate(r)); } };
// PAD=<MB>: before each op (outside its window), allocate U(0, PAD) MB of dead objects, so the op starts at a
// uniformly random nursery phase and in-window GC is an unbiased estimate of the op's amortized GC. Only GCs
// that start inside op windows are counted; their order indices (all scavenges / all mark-compacts) are printed
// so gcwin.mjs can pick the matching --trace-gc-nvp lines (survived/promoted bytes).
const PAD = +(process.env.PAD ?? 0) * 1048576; let seed = 12345; const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pad = () => { if (!PAD) return; let junk = null; const n = Math.floor(rand() * PAD / 40); for (let i = 0; i < n; i++) junk = { a: i, b: junk === null ? 0 : 1 }; return junk; };
const gcs = [], all = []; let on = false, winStart = 0; const wins = [];
new PerformanceObserver(list => { for (const e of list.getEntries()) { const kd = e.detail?.kind ?? e.kind; all.push([kd, e.startTime, e.duration]); } }).observe({ entryTypes: ['gc'] });
const count = 240;
const mount = async () => { api.start(count); await until(() => api.mounted() === count); };
const unmount = async () => { api.stop(); await until(() => api.disposed() === api.mounted()); };
let firstId = 0, theme = 0, k = 0;
const firstRow = () => document.querySelector('.groups').firstElementChild.lastElementChild.firstElementChild;
let el;
const capture = () => { el = { reverse: document.getElementById('reverse'), theme: document.getElementById('theme'), groups: document.querySelector('.groups'), badges: [...document.querySelectorAll('.badge')],
  inc: Array.from({ length: 12 }, (_, i) => document.querySelector(`[data-inc="${i}"]`)), row: Array.from({ length: 12 }, (_, i) => document.querySelector(`[data-row="${i}"]`)) }; };
const OPS = {
  async mount() { await mount(); await unmount(); },
  async reorder() { const before = el.groups.firstElementChild.lastElementChild.firstElementChild.dataset.row; el.reverse.click(); await until(() => el.groups.firstElementChild.lastElementChild.firstElementChild.dataset.row !== before); },
  async context() { const last = el.badges[el.badges.length - 1], t = last.dataset.theme; el.theme.click(); await until(() => last.dataset.theme !== t && el.badges[0].dataset.theme !== t); },
  async increment() { const i = k++ % 12, row = el.row[i], v = row.dataset.value; el.inc[i].click(); await until(() => row.dataset.value !== v); },
};
if (op !== 'mount') { await mount(); capture(); }
for (let i = 0; i < warm; i++) await OPS[op]();
let alloc = 0, wall = 0;
for (let i = 0; i < n; i++) { pad(); const a = v8.getHeapStatistics().total_allocated_bytes, p0 = performance.now(); await OPS[op](); const p1 = performance.now();
  alloc += v8.getHeapStatistics().total_allocated_bytes - a; wall += p1 - p0; wins.push([p0, p1]); }
await new Promise(r => setTimeout(r, 20));
const inWin = t => wins.some(([a, b]) => t >= a && t < b);
const scavIdx = [], mcIdx = []; let si = 0, mi = 0;
for (const [kd, st, d] of all) { if (kd === 1) { if (inWin(st)) scavIdx.push(si); si++; } else if (kd === 4) { if (inWin(st)) mcIdx.push(mi); mi++; } if (inWin(st)) gcs.push([kd, d]); }
const t0 = 0, t1 = wall, a0 = 0, a1 = alloc;
const by = {}; for (const [kd, d] of gcs) { const e = by[kd] ??= [0, 0]; e[0]++; e[1] += d; }
const gcMs = Object.values(by).reduce((s, e) => s + e[1], 0);
const names = { 1: 'scav', 2: 'minorms', 4: 'mc', 8: 'incr', 16: 'weakcb' };
console.log(JSON.stringify({ file, op, n, msPerOp: +((t1 - t0) / n).toFixed(3), gcMsPerOp: +(gcMs / n).toFixed(3), gcShare: +(gcMs / (t1 - t0)).toFixed(3), allocMBPerOp: +((a1 - a0) / n / 1e6).toFixed(2),
  kinds: Object.fromEntries(Object.entries(by).map(([kd, [c, d]]) => [names[kd] ?? kd, { perOp: +(c / n).toFixed(3), msPerOp: +(d / n).toFixed(3) }])), heapMB: +(v8.getHeapStatistics().used_heap_size / 1e6).toFixed(1) }));
console.log('WINIDX ' + JSON.stringify({ n, scav: scavIdx, mc: mcIdx }));
process.exit(0);
