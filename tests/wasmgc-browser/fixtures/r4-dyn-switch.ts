// Dyn switch with scalar case labels (the unboxed dynScalarEq path).
import { classify } from './r4-typed-helper.js';
const vals: unknown[] = ["1", 1, true, "true", 0, -0, NaN, null, undefined, "", false, "0"];
const out: string = vals.map((v) => String(classify(v))).join(",");
console.log(out);
