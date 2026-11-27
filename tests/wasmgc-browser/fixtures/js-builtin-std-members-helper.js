// Reads of names Array.prototype / Function.prototype do not define, on
// compiled arrays and functions (React's element checks on array children and
// defaultProps on components): undefined, by constant and computed keys and
// through `in`; the standard members stay the page's own functions.
function show(xs) { let s = ""; for (let i = 0; i < xs.length; i++) s += (i ? "," : "") + xs[i]; return s; }
export function make() { return [[1, 2], function g(x, y) { return x; }, (x) => x]; }
export function probe(vals, typed) {
  const a = vals[0], f = vals[1], arrow = vals[2];
  const out = [];
  out.push(show([a.$$typeof, a.type, a.props, a.key, a._owner, a.then]));
  out.push(show([f.defaultProps, f.displayName, f.contextTypes, arrow.$$typeof, f.then]));
  out.push(show([typed.$$typeof, typed.type, typed.length]));
  const k = "$$" + "typeof", t = "ty" + "pe";
  out.push(["" + a[k], "" + f[k], "" + typed[t], k in a, k in f, t in a, t in typed].join(","));
  const AP = Object.getPrototypeOf(a), FP = Object.getPrototypeOf(f);
  out.push([a.map === AP.map, a.at === AP.at, a.findLast === AP.findLast, f.call === FP.call, f.apply === FP.apply, arrow.bind === FP.bind,
    typeof a.toSorted, typeof a.with, a.constructor === Array, a.$$typeof === AP.$$typeof].join(","));
  out.push(["map" in a, "flatMap" in a, "call" in f, "apply" in arrow, "hasOwnProperty" in a, "valueOf" in f, "constructor" in a, "isPrototypeOf" in f, "bind" in a, "push" in f].join(","));
  out.push([f.name, f.length, arrow.length, a.length].join(","));
  const m = a.map; out.push(m.call(a, (x) => x * 2).join(","));
  const props = f.defaultProps === undefined ? { x: 1 } : f.defaultProps; out.push(props.x);
  return out.join("\n");
}
