// `'' + x` and `x + ''` in untyped code: ToString(ToPrimitive(x, default)); a string x is x itself.
let order = [];
const tagged = (name, v) => { order.push(name); return v; };
export function show(x) { return '' + x; }
export function showR(x) { return x + ''; }
export function both(a, b) { order = []; const r = tagged("a", a) + tagged("b", b); return r + " " + order.join(""); }
export function attr(el, v) { el.set("k", '' + v); return el.get("k"); }
export function same(s) { const t = '' + s; return t === s && typeof t; }
export function sideEffects() { order = []; const r = '' + tagged("x", 3) + tagged("y", ''); return r + " " + order.join(""); }
export const values = () => [
  "str", "", 0, -0, 1.5, 2 ** 40, NaN, null, undefined, true, false, [1, [2, 3]], [], {},
  { valueOf() { return 7; }, toString() { return "ts"; } },
  { toString() { return "only-ts"; } },
  { valueOf: () => "vo" },
];
export const bads = () => [{ valueOf() { return {}; }, toString() { return {}; } }];
