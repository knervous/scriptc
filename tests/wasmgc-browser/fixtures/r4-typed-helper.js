// Untyped helpers receiving typed records (compiled as JavaScript).
export function readTypedRecord(o) { return o.n; }
export function touch(o) { o.n = o.n + 1; o.label = o.label + "b"; }
export function nestedTag(o) { o.inner.tag = o.inner.tag + "!"; return o.inner.tag; }
export function callField(o) { return o.f(21); }
export function keysOf(o) { return Object.keys(o).join(","); }
export function same(a, b) { return a === b; }
export function spread(o) { const c = Object.assign({}, o); return c.n + c.label + ("inner" in o); }
export function setFn(o) { o.f = function (x) { return x + 100; }; }
export function arrOps(a) {
  const before = a.length + ":" + a[0] + ":" + Array.isArray(a);
  a[1] = a[1] * 10;
  a.push(4);
  const k = "2";
  return before + "|" + a.map(function (x) { return x + 1; }).join(",") + "|" + Object.keys(a).join(",") + "|" + a[k] + "|" + (3 in a) + "|" + a.indexOf(20);
}
export function copyOwn(config) {
  var props = {}, propName, hasOwn = Object.prototype.hasOwnProperty;
  for (propName in config) hasOwn.call(config, propName) && propName !== "key" && (props[propName] = config[propName]);
  return Object.keys(props).join(",") + "|" + props.items.length + "|" + hasOwn.call(config, "toString");
}
// React's reconciler gate: `"object" === typeof x && null !== x` over typed and boxed values.
export function objectGate(v) { return "object" === typeof v && null !== v ? "obj" : typeof v; }
export function applyTo(f, v) { return f(v); }
// React's component-stack probe: clear V8's stack hook, run, restore it.
export function stackHook() {
  var before = typeof Error.prepareStackTrace;
  Error.prepareStackTrace = function () { return "hooked"; };
  var inside = typeof Error.prepareStackTrace;
  var prev = Error.prepareStackTrace;
  Error.prepareStackTrace = void 0;
  var cleared = typeof Error.prepareStackTrace;
  Error.prepareStackTrace = prev;
  var restored = Error.prepareStackTrace === prev;
  Error.prepareStackTrace = void 0;
  return before + "," + inside + "," + cleared + "," + restored;
}
// React's error delivery: run a render that throws, hand the caught value to a callback.
export function deliver(render, onError) {
  try { render(); } catch (x) { var captured = { value: x }; onError(captured.value, { componentStack: "\n in X" }); }
}
// for-of over untyped values: arrays (grown mid-loop), strings, typed arrays, keys, a non-iterable.
export function forOfAll(typed, bad) {
  const out = [];
  const xs = [1, 2, 3];
  for (const x of xs) { if (x === 1) xs.push(4); out.push(x); }
  for (const ch of "hé!") out.push(ch);
  for (const t of typed) out.push(t);
  for (const k of Object.keys({ a: 1, b: 2 })) out.push(k);
  let firstOnly = "";
  for (const x of xs) { firstOnly += x; break; }
  out.push(firstOnly);
  try { for (const z of bad) out.push(z); } catch (e) { out.push(e instanceof TypeError ? "TypeError: " + e.message : "other"); }
  return out.join(",");
}
// Page code calls these compiled functions: six arguments (past the four passed
// directly), an explicit this, a missing argument, and arguments.length.
export const pageCallees = {
  six: function (a, b, c, d, e, f) { return a + "." + b + "." + c + "." + d + "." + e + "." + f + "." + arguments.length + "." + this.tag; },
  missing: function (a, b) { return a + String(b) + arguments.length + (this === undefined); },
};
// A switch over an untyped value with scalar case labels: === per kind, never coercion.
export function classify(v) {
  switch (v) {
    case "1": return "str1";
    case 1: return "num1";
    case true: return "true";
    case "true": return "strtrue";
    case 0: return "zero";
    case NaN: return "nan";
    case null: return "null";
    default: return "other";
  }
}
// An untyped switch over many string labels (dyn length dispatch).
export function eventKind(name) {
  switch (name) {
    case "click": return 1;
    case "close": return 2;
    case "copy": return 3;
    case "cut": return 4;
    case "dblclick": return 5;
    case "keydown": return 6;
    case "keyup": return 7;
    case "click": return 99;
    case "10": return 8;
    case "": return 9;
    default: return 0;
  }
}
