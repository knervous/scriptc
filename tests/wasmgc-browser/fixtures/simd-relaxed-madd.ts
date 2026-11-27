// experimentalRelaxedSimd: the SIMD library's relaxed multiply-adds lower to
// f32x4.relaxed_madd / relaxed_nmadd. Every product and sum here is exact in
// f32, so the fused and unfused results (and the scalar fallback Node runs)
// agree; inexact operands may differ in the low bits under the option.
// @options: {"experimentalRelaxedSimd": true}
import { v128, f32x4 } from "../../../packages/simd/simd.intrinsics.ts";
const show = (v: v128): string => [f32x4.extract_lane(v, 0), f32x4.extract_lane(v, 1), f32x4.extract_lane(v, 2), f32x4.extract_lane(v, 3)].join(",");
const a = f32x4.of(1.5, -2, 3, 0.25), b = f32x4.of(2, 4, -0.5, 8), c = f32x4.of(0.5, 1, 1, -3);
console.log(show(f32x4.relaxed_madd(a, b, c)), show(f32x4.relaxed_nmadd(a, b, c)));
const data = new Float32Array(64);
for (let i = 0; i < data.length; i++) data[i] = (i % 9) - 4;
let acc = f32x4.splat(0);
for (let i = 0; i < data.length; i += 4) acc = f32x4.relaxed_madd(v128.load(data, i), f32x4.splat(0.5), acc);
console.log(show(acc));
