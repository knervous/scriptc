// Inherited builtin members read (not called) on untyped compiled values:
// Array/String/Number/Boolean/Object/Function.prototype members by constant
// and computed keys, `in`, and calling a member read as a value.
const at = (o, k) => o[k];
export function make() { return [[1, 2, 3], "abc", 3.14159, { a: 1 }, true, function named(a, b) { return a + b; }]; }
export function probe(vals) {
  const arr = vals[0], s = vals[1], n = vals[2], rec = vals[3], b = vals[4], fn = vals[5];
  const out = [];
  out.push([typeof arr.map, typeof s.toUpperCase, typeof n.toFixed, typeof rec.valueOf, typeof rec.constructor, typeof b.valueOf, typeof fn.call, typeof fn.bind].join(" "));
  out.push([arr.map === Array.prototype.map, s.toUpperCase === String.prototype.toUpperCase, arr.map === arr.map, arr.constructor === Array, rec.hasOwnProperty === Object.prototype.hasOwnProperty, arr.hasOwnProperty === rec.hasOwnProperty].join(" "));
  out.push([typeof at(rec, "constructor"), typeof at(arr, "push"), typeof at(n, "toFixed"), typeof at(fn, "call"), typeof at(b, "valueOf"), typeof at(arr, "nope"), typeof at(rec, "nope"), typeof arr.nope].join(" "));
  out.push([at(arr, "push") === arr.push, at(rec, "valueOf") === rec.valueOf, at(n, "toFixed") === n.toFixed, at(arr, "map") === Array.prototype.map].join(" "));
  out.push(["map" in arr, "nope" in arr, "call" in fn, "length" in arr, "0" in arr, "valueOf" in rec, arr.hasOwnProperty("map"), arr.hasOwnProperty("0"), Object.keys(arr).join("/")].join(" "));
  out.push([at(rec, "__proto__") === Object.getPrototypeOf(rec), arr.__proto__ === Array.prototype, rec.toLocaleString(), rec.valueOf() === rec, rec.propertyIsEnumerable("a"), rec.isPrototypeOf(arr)].join(" "));
  let msg = ""; try { "x" in s; } catch (e) { msg = e.name + ": " + e.message; }
  out.push(msg);
  const m = arr.map; out.push(m.call(arr, (x) => x + 1).join(","));
  const push = arr.push; push.call(arr, 4); out.push(arr.length + " " + arr.join(","));
  const slice = Array.prototype.slice; out.push(slice.call(arr, 1).join(","));
  const tf = n.toFixed, up = s.toUpperCase; out.push(tf.call(n, 1) + " " + up.call(s));
  const { length: L, map: M } = arr; out.push(L + " " + typeof M);
  out.push([arr.reduceRight((acc, x) => acc + x, ""), [...arr.keys()].join(","), arr.copyWithin(0, 3).join(",")].join(" "));
  return out.join("\n");
}
