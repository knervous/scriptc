// @native-any-only: object patterns with defaults over TS any compile only where TS any is a native dyn value
// Object destructuring of TS any: defaults fire on undefined only, lazily and
// in source order between the property reads; getters run once each;
// nested and constant computed keys; closures capture the dyn bindings.
let order = "";
const note = (s: string) => { order += s + ","; return s; };
const drain = () => { const o = order; order = ""; return o; };
const tryIt = (label: string, f: () => string) => { try { console.log(label, f()); } catch (e) { console.log(label, "throw", (e as Error).name); } };
function defaults(t0: any) { const { a = note("da"), b = note("db"), c = note("dc") } = t0; return [a, b, c].join(","); }
tryIt("dflt1", () => defaults({ b: 2 }) + "|" + drain());
tryIt("dflt2", () => defaults({ a: null, b: undefined, c: 0 }) + "|" + drain());
function getters(t0: any) { const { x = note("dx"), y = note("dy") } = t0; return x + "," + y; }
const g: any = { get x() { note("gx"); return undefined; }, get y() { note("gy"); return "Y"; } };
tryIt("getters", () => getters(g) + "|" + drain());
const h: any = globalThis;
const pg: any = h.auditMakeAccessor();
function pageRead(t0: any) { const { n, missing = "m" } = t0; return n + missing; }
tryIt("pageGetter", () => pageRead(pg) + "|" + h.auditAccessorHits());
function nested(t0: any) { const { a: { b: { c } } } = t0; return String(c); }
tryIt("nested", () => nested({ a: { b: { c: 3 } } }));
tryIt("nestedMissing", () => nested({ a: {} }));
tryIt("nestedNull", () => nested({ a: null }));
function nestedDefault(t0: any) { const { a: { b = note("db2") } = (note("da2"), {}) } = t0; return String(b); }
tryIt("nestedDefault", () => nestedDefault({}) + "|" + drain());
tryIt("nestedDefault2", () => nestedDefault({ a: { b: 1 } }) + "|" + drain());
const KEY = "k1";
function computed(t0: any) { const { [KEY]: v, "lit-key": w, 0: z } = t0; return [v, w, z].join(","); }
tryIt("computed", () => computed({ k1: "v", "lit-key": "w", 0: "z" }));
function one(t0: any) { const { id } = t0; return String(id); }
tryIt("onePrim", () => one(5) + one("s") + one(true));
function len(t0: any) { const { length } = t0; return String(length); }
tryIt("len", () => len("héllo") + "," + len([1, 2]) + "," + len({ length: "L" }));
function reassign(t0: any) { let { id, n } = t0; id = id + "!"; n += 1; return id + n; }
tryIt("reassign", () => reassign({ id: "x", n: 1 }) + reassign({ id: 2, n: "1" }));
function closures(t0: any) { const { id } = t0; return (item: any) => item.id === id; }
const pred = closures({ id: 2 });
tryIt("closure", () => [pred({ id: 2 }), pred({ id: "2" }), pred({})].join(","));
let evals = 0;
const src = () => { evals++; return { a: 1, b: 2 }; };
function once() { const { a, b } = src() as any; return a + b; }
tryIt("once", () => once() + "|" + evals);
function shadow(t0: any) { const { id: t1, t1: id } = t0; return t1 + ":" + id; }
tryIt("shadow", () => shadow({ id: 1, t1: 2 }));
function param({ id, n = 5 }: any) { return id + n; }
tryIt("param", () => param({ id: 1 }) + "," + param({ id: 1, n: 2 }));
tryIt("forOf", () => { let s = ""; const rows: any = [{ id: 1 }, { id: 2 }]; for (const { id } of rows) s += id; return s; });
