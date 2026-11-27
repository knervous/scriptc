// Unary minus on an untyped value applies ToNumeric (valueOf, null -> 0,
// numeric strings, arrays through toString) instead of demanding a number.
import { run } from "./dyn-unary-minus-helper.js";
console.log(run());
const a: any = JSON.parse('["7"]');
console.log(-a, -a[0]);
