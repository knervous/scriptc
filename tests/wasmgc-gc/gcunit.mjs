// GC unit costs of object layouts: a live linked list of n objects, each with 4 property values,
// laid out as (split) a 4-field header struct + a separate 4-slot anyref array (today's dyn:obj),
// (inline) one struct with the header and 4 inline fields, (inline-slim) one struct {shape, s0..s3},
// (js) a JS object literal with 5 in-object properties. Times minor GCs (copy, then promote) and a
// major GC with the list live. usage: node --expose-gc --single-threaded-gc gcunit.mjs [n=200000] [reps=5]
import binaryen from '../../packages/compiler/node_modules/binaryen/index.js';
const n = +(process.argv[2] ?? 200000), reps = +(process.argv[3] ?? 5);
const wat = `(module
 (rec
  (type $arr (array (mut anyref)))
  (type $hdr (sub (struct (field (mut anyref)) (field (mut (ref null $arr))) (field (mut anyref)) (field (mut externref)))))
  (type $inl4 (sub $hdr (struct (field (mut anyref)) (field (mut (ref null $arr))) (field (mut anyref)) (field (mut externref)) (field (mut anyref)) (field (mut anyref)) (field (mut anyref)) (field (mut anyref)))))
  (type $slim (struct (field (mut anyref)) (field (mut anyref)) (field (mut anyref)) (field (mut anyref)) (field (mut anyref))))
  (type $box (struct (field f64))))
 (global $keep (mut anyref) (ref.null any))
 (global $shape (mut anyref) (ref.null any))
 (func $init (global.set $shape (struct.new $box (f64.const 1))))
 (start $init)
 (func (export "split") (param $n i32) (local $i i32) (local $p anyref)
  (local.set $p (global.get $keep))
  (loop $l (local.set $p (struct.new $hdr (global.get $shape) (array.new_fixed $arr 4 (local.get $p) (ref.i31 (local.get $i)) (global.get $shape) (ref.null any)) (ref.null any) (ref.null extern)))
   (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $l (i32.lt_s (local.get $i) (local.get $n))))
  (global.set $keep (local.get $p)))
 (func (export "inline") (param $n i32) (local $i i32) (local $p anyref)
  (local.set $p (global.get $keep))
  (loop $l (local.set $p (struct.new $inl4 (global.get $shape) (ref.null $arr) (ref.null any) (ref.null extern) (local.get $p) (ref.i31 (local.get $i)) (global.get $shape) (ref.null any)))
   (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $l (i32.lt_s (local.get $i) (local.get $n))))
  (global.set $keep (local.get $p)))
 (func (export "slim") (param $n i32) (local $i i32) (local $p anyref)
  (local.set $p (global.get $keep))
  (loop $l (local.set $p (struct.new $slim (global.get $shape) (local.get $p) (ref.i31 (local.get $i)) (global.get $shape) (ref.null any)))
   (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $l (i32.lt_s (local.get $i) (local.get $n))))
  (global.set $keep (local.get $p)))
 (func (export "boxes") (param $n i32) (local $i i32) (local $p anyref)
  (local.set $p (global.get $keep))
  (loop $l (local.set $p (struct.new $slim (global.get $shape) (local.get $p) (struct.new $box (f64.convert_i32_s (local.get $i))) (global.get $shape) (ref.null any)))
   (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $l (i32.lt_s (local.get $i) (local.get $n))))
  (global.set $keep (local.get $p)))
 (func (export "drop") (global.set $keep (ref.null any))))`;
const mod = binaryen.parseText(wat);
mod.setFeatures(binaryen.Features.All);
if (!mod.validate()) throw Error('invalid');
const { instance } = await WebAssembly.instantiate(mod.emitBinary(), {});
const x = instance.exports;
let keepJs = null; const shape = { s: 1 };
const js = (n) => { let p = keepJs; for (let i = 0; i < n; i++) p = { shape, next: p, v: i, s: shape, t: undefined }; keepJs = p; };
const kinds = { split: x.split, inline: x.inline, slim: x.slim, boxes: x.boxes, js };
const t = (f) => { const a = performance.now(); f(); return performance.now() - a; };
const res = {};
for (let r = 0; r < reps; r++) for (const [k, build] of Object.entries(kinds)) {
  x.drop(); keepJs = null; gc(); gc();
  const h0 = process.memoryUsage().heapUsed;
  const ta = t(() => build(n));
  const m1 = t(() => gc({ type: 'minor' })), m2 = t(() => gc({ type: 'minor' }));
  const h1 = process.memoryUsage().heapUsed;
  const M = t(() => gc({ type: 'major' }));
  const e = res[k] ??= { alloc: [], copy: [], promote: [], major: [], bytes: 0 };
  e.alloc.push(ta); e.copy.push(m1); e.promote.push(m2); e.major.push(M); e.bytes = (h1 - h0) / n;
}
const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
console.log(`n=${n} objects (ns per object, median of ${reps})`);
for (const [k, e] of Object.entries(res)) console.log(k.padEnd(7), 'B/obj', e.bytes.toFixed(0).padStart(4), ' alloc', (1e6 * med(e.alloc) / n).toFixed(1).padStart(6), ' minor1(copy)', (1e6 * med(e.copy) / n).toFixed(1).padStart(6), ' minor2(promote)', (1e6 * med(e.promote) / n).toFixed(1).padStart(6), ' major(mark)', (1e6 * med(e.major) / n).toFixed(1).padStart(6));
