// `instanceof Map` / `instanceof Set` on an untyped value holding a typed collection (10-30: `new Map<string, number>()`
// held as unknown answered false; an untyped `new Map()` answered true).
// @native-only: engine dyn refuses `instanceof` against a builtin class on an untyped value
const vals: unknown[] = [new Map<string, number>([["a", 1]]), new Set<number>([1]), new Map<number, string>(), new Set<string>(), [1], {}, null];
console.log(vals.map((v) => `${v instanceof Map ? "M" : ""}${v instanceof Set ? "S" : ""}` || "-").join(" "));
const one: unknown = new Map<string, number>([["k", 2]]);
if (one instanceof Map) console.log("map", one.size, [...one.keys()].join(","));
const kind = (x: unknown): string => (x instanceof Map ? "M" : x instanceof Set ? "S" : "-");
console.log(kind(new Map()), kind(new Set()), kind(new Map<string, boolean>()), kind(new Set<number>([2])), kind("x"));
