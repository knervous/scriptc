// Element stores through a type parameter constrained to a union of typed
// arrays: each instantiation writes its own kind (f32 rounding vs f64), with
// compound assignment and an offset; a plain array narrowed by instanceof.
function fill<Out extends Float32Array | Float64Array>(out: Out, offset: number): Out {
  for (let i = 0; i < 4; i++) out[offset + i] = 1 / (i + 3);
  out[offset] += 0.1;
  return out;
}
const f32 = fill(new Float32Array(6), 1);
const f64 = fill(new Float64Array(6), 2);
console.log(Array.from(f32).join(","));
console.log(Array.from(f64).join(","));
function write(target: Float32Array | number[], v: number): void {
  if (target instanceof Float32Array) {
    target[0] = v;
    return;
  }
  target[0] = v;
}
const plain = [0, 0];
const typed = new Float32Array(2);
write(plain, 1 / 3);
write(typed, 1 / 3);
console.log(plain[0], typed[0]);
