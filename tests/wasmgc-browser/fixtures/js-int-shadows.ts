// Int shadows: untyped locals and parameters that mostly hold int32s carry an unboxed copy
// (native dyn). Definitions of every kind, int uses (bitwise operands, === against numbers,
// switch labels, number conversions) and other uses must all see JS values exactly.
// @hits(native,native-any): ^\$hit\.shadow\.def$
// @hits(native,native-any): ^\$hit\.shadow\.use$
// @hits(native,native-any): ^\$hit\.shadow\.param$
// @hits(native,native-any): ^\$hit\.shadow\.switch$
// @hits(native,native-any): ^\$hit\.int\.eq$
import { bits, lanes, dense, sparse, mixed, edges, throwing, captured, loop, copies } from "./js-int-shadows-helper.js";
const log: string[] = [];
const obj = (v: unknown, name: string) => ({ valueOf() { log.push(name); return v; } });
console.log(bits(6, 5), "|", bits(12, 4), "|", bits("7", 5), "|", bits(obj(4, "b"), 7));
console.log(lanes(3, 1, 7), lanes(3, 3, 1), lanes("3", 2, 3), lanes(3.5, 3, 3), lanes(-0, 0, 0), lanes(NaN, 1, 1));
console.log(lanes(obj(3, "r"), 1, 3), lanes(2 ** 31, 1, 2 ** 31), lanes(null, 0, 0), lanes(undefined, 1, 1), log.join(","));
log.length = 0;
console.log([0, 1, 2, 3, 4, 5, 6, 7, 9, 12, 13, 16, 17, -1, "3", 3.7, null, "x"].map((n) => dense(n)).join(" "));
console.log([-5, 1, 1000, 40000, 2147483647, 2147483648, 0, "1000", 1.5, "x"].map((n) => sparse(n)).join(" "));
console.log(mixed(22, null, log), mixed(22, obj(6, "m"), log), log.join(","));
log.length = 0;
console.log(edges(-1), "|", edges(5), "|", edges(-3));
console.log(throwing(7, { flags: 3 }), throwing(6, null), captured(15), captured(4));
console.log(loop([1, 2, 3, 0, 257, 300]), loop([]), loop([0]), copies(5, "b"), copies(4, 9));
