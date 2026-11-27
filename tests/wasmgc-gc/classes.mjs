// classes.mjs <census.json...> : allocation per op by object class (escape/lifetime classification of
// sites). The census is wgc-agent-out/w6-gc/tools/allocrun2.sh output (allocprobe2 build, ALLOC_WINDOWS).
// Type ids ($535 dyn:obj, $536 anyref array, ...) are those of the base graph build at 07db187d.
import fs from 'node:fs';
const T = { '$536': 'anyarr', '$535': 'dyn:obj', '$523': 'dyn:arr', '$544': 'dyn:str box', '$541': 'dyn:num box', '$400': 'cell{any,i32}', '$512': 'shape', '$513': 'i32 array' };
// CLOSURE_TYPES: a JSON list of the build's closure struct types ("$N", subtypes of $0 in its .wat).
const CLO = new Set(JSON.parse(fs.readFileSync(process.env.CLOSURE_TYPES ?? 'closure-types.json')));
const KNOWN = new Set(['$535', '$536', '$523', '$544', '$541', '$512', '$513']);
const cls = (ty, site) => {
  if (CLO.has(ty)) return 'I closures';
  if (ty === '$544') return 'B string boxes (never escape)';
  if (ty === '$541') return 'A number boxes (never escape)';
  if (/uniformRest|invoke\.bind|\$dyn\.call|dyn\.apply|construct\.args/.test(site) && (ty === '$536' || ty === '$523')) return 'C argument packs (never escape)';
  if (/\$obj\.grow/.test(site)) return 'D grown slot arrays (old array dies)';
  if (/keys|ownKeys|forin/.test(site)) return 'E key arrays (temporary)';
  if (/\$arr\.slice|\$dyn\.arr\.ctor|arr\.push|arr\.concat/.test(site)) return 'F array temporaries/copies';
  if (/ReactElement|_25fn27\b|useMemoCache|mountWorkInProgressHook|updateWorkInProgressHook|pushSimpleEffect|mountEffectImpl|createFunctionComponentUpdateQueue|readContextForConsumer|createWorkInProgress|_25fn205|_25fn206|_25fn255|_25fn121/.test(site)) return 'G per-render React state (escapes into fiber tree)';
  if (/construct\.fixed|createFiber/.test(site)) return 'H constructed objects (fibers etc., long-lived)';
  if (ty === '$512' || ty === '$513') return 'J runtime metadata (shapes)';
  if (!KNOWN.has(ty)) return 'L closure environments / cells / other structs';
  if (/^\$\$clo\.|_25fn\d+_[A-Z]|\$_temp/.test(site)) return 'G per-render React state (escapes into fiber tree)';
  return 'K other';
};
for (const f of process.argv.slice(2)) {
  const rows = JSON.parse(fs.readFileSync(f)); const by = new Map(); let tc = 0, tb = 0;
  for (const [key, c, b] of rows) { const [kind, ty] = key.split(' @ ')[0].split(' '); const site = key.split(' @ ')[1] ?? ''; const k = cls(ty, site); const e = by.get(k) ?? [0, 0]; e[0] += c; e[1] += b; by.set(k, e); tc += c; tb += b; }
  console.log(`${f}: ${Math.round(tc)} allocs, ${(tb / 1e3).toFixed(1)} KB per op (compressed-pointer model)`);
  for (const [k, [c, b]] of [...by].sort((p, q) => q[1][1] - p[1][1])) console.log('  ' + String(Math.round(c)).padStart(7) + (100 * c / tc).toFixed(0).padStart(4) + '%' + (b / 1e3).toFixed(1).padStart(9) + 'KB' + (100 * b / tb).toFixed(0).padStart(4) + '%  ' + k);
}
