// snapdiff.mjs <before> <after> [N=40] [--wat=<file.wat>] [--canon-offset=k]: per (type,name) count/bytes delta, categories
import fs from 'node:fs';
const [a, b, nArg, ...rest] = process.argv.slice(2); const N = +(nArg ?? 40);
const watF = rest.find(x => x.startsWith('--wat='))?.slice(6); let off = rest.find(x => x.startsWith('--canon-offset='))?.slice(15);
const tdesc = new Map();
if (watF) { const t = fs.readFileSync(watF, 'utf8'); const end = t.indexOf('\n (func ');
  for (const m of t.slice(0, end).matchAll(/^ *\(type \$(\d+) (.*)$/gm)) tdesc.set(+m[1], m[2]); }
const agg = file => { const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const f = s.snapshot.meta.node_fields, types = s.snapshot.meta.node_types[0], nf = f.length;
  const iType = f.indexOf('type'), iName = f.indexOf('name'), iSize = f.indexOf('self_size'); const m = new Map();
  for (let i = 0; i < s.nodes.length; i += nf) { const t = types[s.nodes[i + iType]], name = s.strings[s.nodes[i + iName]];
    const key = (t + ' ' + name.slice(0, 50)).replace(/\n/g, ' '); const e = m.get(key) ?? [0, 0]; e[0]++; e[1] += s.nodes[i + iSize]; m.set(key, e); }
  return m; };
const A = agg(a), B = agg(b), keys = new Set([...A.keys(), ...B.keys()]), rows = [];
for (const k of keys) { const x = A.get(k) ?? [0, 0], y = B.get(k) ?? [0, 0]; if (y[0] - x[0] || y[1] - x[1]) rows.push([k, y[0] - x[0], y[1] - x[1]]); }
// canonical offset: dyn:obj is the 4-field struct {shape, slots, anyref, externref}
if (off === undefined && watF) { const obj = [...tdesc].find(([, d]) => /^\(struct \(field \(mut \(ref null \$\d+\)\)\) \(field \(mut \(ref null \$\d+\)\)\) \(field \(mut anyref\)\) \(field \(mut externref\)\)\)\)$/.test(d));
  const top48 = rows.filter(r => /\$canon\d+ \(wasm\)/.test(r[0])).sort((p, q) => q[1] - p[1]);
  const c48 = rows.find(r => /\$canon\d+ \(wasm\)/.test(r[0]) && r[1] > 0 && Math.abs(r[2] / r[1] - 48) < 0.01);
  if (obj && c48) off = +c48[0].match(/canon(\d+)/)[1] - obj[0]; }
const label = k => { const m = k.match(/\$canon(\d+) \(wasm\)/); if (!m || off === undefined) return k; const i = +m[1] - +off; return `wasm $${i} ${(tdesc.get(i) ?? '?').slice(0, 90)}`; };
const cat = k => /\(wasm\)/.test(k) ? 'wasm' : /JSProxy/.test(k) ? 'proxy' : /DynTarget/.test(k) ? 'facade-target' : /^closure/.test(k) ? 'closure' : /^(string|concatenated|sliced)/.test(k) ? 'string' : /^code/.test(k) ? 'code' : /Impl$|SymbolTreeNode|CSSStyleDecl/.test(k) ? 'jsdom' : k.split(' ')[0];
const cats = new Map(); for (const [k, c, by] of rows) { const g = cats.get(cat(k)) ?? [0, 0]; g[0] += c; g[1] += by; cats.set(cat(k), g); }
const tc = rows.reduce((s, r) => s + r[1], 0), tb = rows.reduce((s, r) => s + r[2], 0);
console.log(`delta: ${tc} nodes, ${(tb / 1e3).toFixed(0)} KB (canon offset ${off})`);
for (const [k, [c, by]] of [...cats].sort((p, q) => q[1][1] - p[1][1])) console.log('  cat', k.padEnd(14), String(c).padStart(8), (by / 1e3).toFixed(1).padStart(9), 'KB');
for (const [k, c, by] of rows.sort((p, q) => q[2] - p[2]).slice(0, N)) console.log(String(c).padStart(8), (by / 1e3).toFixed(1).padStart(9), (c ? by / c : 0).toFixed(0).padStart(5), label(k));
