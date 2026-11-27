// livesnap.mjs <stageDir> <file.wasm|file.js> <outPrefix> : warm mount/unmount, then heap snapshots
// before and after a mount (full GCs settled); writes <outPrefix>.{before,after}.heapsnapshot
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import inspector from 'node:inspector';
const probe = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../react-probe');
const req = createRequire(path.join(probe, 'profile-deps/package.json')); const { JSDOM } = req('jsdom');
const stage = path.resolve(process.argv[2]), file = process.argv[3], prefix = process.argv[4];
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLIFrameElement', 'MutationObserver', 'Event', 'MouseEvent', 'CustomEvent'])
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window); globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
const errors = []; globalThis.reportError = e => errors.push(String(e));
let api;
if (file.endsWith('.js')) api = await import(pathToFileURL(path.join(stage, file)));
else { const { instantiateWasmGc } = await import(pathToFileURL(path.join(stage, 'host.js'))); const m = await instantiateWasmGc(fs.readFileSync(path.join(stage, file)), { onUncaught: e => errors.push(String(e)) }); m.main(); api = m.instance.exports; }
const until = async (test) => { while (!test()) { if (errors.length) throw Error(errors.join('\n')); await new Promise(r => setImmediate(r)); } };
const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); globalThis.gc(); } };
const session = new inspector.Session(); session.connect();
const snap = async (out) => { const fd = fs.openSync(out, 'w'); const h = m => fs.writeSync(fd, m.params.chunk); session.on('HeapProfiler.addHeapSnapshotChunk', h);
  await new Promise((res, rej) => session.post('HeapProfiler.takeHeapSnapshot', { reportProgress: false }, e => e ? rej(e) : res())); session.off('HeapProfiler.addHeapSnapshotChunk', h); fs.closeSync(fd); };
for (let k = 0; k < 2; k++) { api.start(240); await until(() => api.mounted() === 240); api.stop(); await until(() => api.disposed() === api.mounted()); }
await settle(); const before = process.memoryUsage().heapUsed; await snap(prefix + '.before.heapsnapshot');
api.start(240); await until(() => api.mounted() === 240);
await settle(); const after = process.memoryUsage().heapUsed; await snap(prefix + '.after.heapsnapshot');
console.log(file, 'live after mount (KB):', ((after - before) / 1e3).toFixed(0));
process.exit(0);
