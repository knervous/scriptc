// gcwin.mjs <gcloop output with --trace-gc-nvp> : the op's amortized GC from the in-window GCs only
// (gcloop PAD mode): per op scavenges, scavenge ms (V8's own pause), survived/promoted MB, mark-compact ms.
import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const res = JSON.parse(lines.filter(l => l.startsWith('{')).pop()), idx = JSON.parse(lines.find(l => l.startsWith('WINIDX ')).slice(7));
const g = lines.filter(l => l.includes('GC: {')).map(l => JSON.parse(l.slice(l.indexOf('GC: {') + 4)));
const sc = g.filter(x => x.gc === 's'), mc = g.filter(x => x.gc === 'mc'), n = idx.n;
const pick = (arr, ids) => ids.map(i => arr[i]).filter(Boolean);
const S = pick(sc, idx.scav), M = pick(mc, idx.mc);
const sum = (a, k) => a.reduce((t, x) => t + (x[k] ?? 0), 0);
console.log(JSON.stringify({ file: res.file, op: res.op, n, wallMs: res.msPerOp, allocMB: res.allocMBPerOp, scavPerOp: +(S.length / n).toFixed(3), scavMs: +(sum(S, 'pause') / n).toFixed(3),
  survMB: +(sum(S, 'new_space_survived') / n / 1e6).toFixed(2), promMB: +(sum(S, 'promoted') / n / 1e6).toFixed(2), mcPerOp: +(M.length / n).toFixed(3), mcMs: +(sum(M, 'pause') / n).toFixed(3),
  survPerScavMB: S.length ? +(sum(S, 'new_space_survived') / S.length / 1e6).toFixed(2) : 0, matched: `${S.length}/${idx.scav.length}` }));
