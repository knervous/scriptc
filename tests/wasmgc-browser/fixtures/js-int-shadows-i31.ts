// Int shadows with experimentalDynI31: the dyn values beside the shadows (boxed on read, compared,
// converted at entry) are i31refs for small integers and boxes for everything else; both read exactly.
// @options: {"experimentalDynI31":true}
// @native-only: experimentalDynI31 is a native dyn representation
// @hits(native,native-any): ^\$hit\.shadow\.def$
// @hits(native,native-any): ^\$hit\.shadow\.param$
// @hits(native,native-any): ^\$hit\.int\.eq$
import { bits, lanes, dense, sparse, mixed, edges, throwing, captured, loop, copies } from "./js-int-shadows-helper.js";
const log: string[] = [];
const obj = (v: unknown, name: string) => ({ valueOf() { log.push(name); return v; } });
console.log(bits(6, 5), "|", bits(12, 4), "|", bits("7", 5), "|", bits(obj(4, "b"), 7), "|", bits(2 ** 30, 2 ** 30 + 4));
console.log(lanes(3, 1, 7), lanes("3", 2, 3), lanes(3.5, 3, 3), lanes(-0, 0, 0), lanes(2 ** 30, 1, 2 ** 30), lanes(-(2 ** 30) - 1, 1, 1), lanes(obj(3, "r"), 1, 3), log.join(","));
log.length = 0;
console.log([0, 1, 3, 5, 9, 12, -1, 2 ** 30, "x", 3.7].map((n) => dense(n)).join(" "), [-5, 1000, 40000, 2147483647, 2 ** 30].map((n) => sparse(n)).join(" "));
console.log(mixed(22, null, log), mixed(22, obj(6, "m"), log), log.join(","), edges(-1), edges(2 ** 30));
console.log(throwing(7, { flags: 3 }), throwing(6, null), captured(15), loop([1, 2, 3, 0, 2 ** 30, 300]), copies(5, "b"), copies(4, 2 ** 31));
