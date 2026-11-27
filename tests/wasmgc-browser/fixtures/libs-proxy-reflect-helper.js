// immer's draft machinery in miniature: Proxy and Proxy.revocable over
// compiled targets and handlers, Reflect.ownKeys / getOwnPropertyDescriptor
// with symbol keys, iteration through a proxy over a compiled array, and the
// Object.hasOwnProperty.call spelling.
var STATE = Symbol.for("state");
function getDescriptorFromProto(source, prop) {
  if (!(prop in source)) return;
  let proto = Object.getPrototypeOf(source);
  for (; proto; ) {
    let desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc) return desc;
    proto = Object.getPrototypeOf(proto);
  }
}
var traps = {
  get(state, prop) { if (prop === STATE) return state; var v = state.base[prop]; return typeof v === "number" ? v * 10 : v; },
  set(state, prop, value) { state.copy = state.copy || Object.assign({}, state.base); state.copy[prop] = value; return true; },
  has(state, prop) { return prop in state.base; },
  ownKeys(state) { return Reflect.ownKeys(state.base); },
  getOwnPropertyDescriptor(state, prop) { var d = Reflect.getOwnPropertyDescriptor(state.base, prop); if (d) d.configurable = true; return d; },
};
export function run() {
  var base = { a: 1, b: "x" }, state = { base: base, copy: null };
  var p = new Proxy(state, traps), r = Proxy.revocable(state, traps);
  var out = [p.a, p.b, p[STATE] === state, "a" in p, "z" in p];
  p.a = 5;
  out.push(state.copy.a, base.a, Object.keys(p).join(","), r.proxy.a);
  r.revoke();
  try { r.proxy.a; out.push("no"); } catch (e) { out.push(e instanceof TypeError); }
  var source = [10, 20, 30];
  var d = getDescriptorFromProto(source, Symbol.iterator);
  out.push(typeof d, typeof d.value, Symbol.iterator in source);
  var ap = new Proxy([source], { get(t, prop) { if (prop === "length") return source.length; var v = source[prop]; if (v !== undefined) return v; var dd = getDescriptorFromProto(source, prop); return dd && dd.value; } });
  var sum = 0;
  for (var x of ap) sum += Number(x);
  ap.forEach(function (v) { sum += Number(v); });
  out.push(sum);
  var o = { k: 1 }, child = Object.create(o); child.own = 2;
  out.push(Object.hasOwnProperty.call(o, "k"), Object.hasOwnProperty.call(child, "k"), Object.prototype.propertyIsEnumerable.call(child, "own"), Reflect.has(child, "k"), Reflect.getPrototypeOf(child) === o);
  out.push(Object.prototype.hasOwnProperty.call([1], "length"), Object.hasOwnProperty.call("ab", "length"), Object.hasOwnProperty.call("ab", "2"));
  return out.join("|");
}
