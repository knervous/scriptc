// react-dom's shapes: new WeakMap() at module init; PossiblyWeakMap = "function" === typeof WeakMap ? WeakMap : Map.
var CapturedStacks = new WeakMap();
var PossiblyWeakMap = "function" === typeof WeakMap ? WeakMap : Map;
function caught(f) { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } }
export function run() {
  var k1 = {}, k2 = function () {}, out = [];
  CapturedStacks.set(k1, "stack1");
  out.push(CapturedStacks.get(k1), CapturedStacks.has(k1), CapturedStacks.has({}), CapturedStacks.delete(k1), CapturedStacks.has(k1), CapturedStacks.get(k1));
  var pm = new PossiblyWeakMap();
  pm.set(k2, 7);
  out.push(pm.get(k2), pm.has(k2), typeof pm.size, typeof pm.clear, typeof pm.forEach, pm instanceof WeakMap, pm instanceof Map, Object.prototype.toString.call(pm));
  var ws = new WeakSet([k1, k2]);
  out.push(ws.has(k1), ws.add(k2) === ws, ws.delete(k1), ws.has(k1), typeof ws.size, ws instanceof WeakSet, Object.prototype.toString.call(ws));
  out.push(caught(function () { return new WeakMap().set(1, 2); }), caught(function () { return new WeakSet().add("s"); }),
    caught(function () { return new WeakMap([[1, 2]]); }), caught(function () { return new WeakMap().get(1); }), caught(function () { return new WeakMap().has("x"); }));
  out.push(caught(function () { return new WeakMap([[k1, 1], [k2, 2]]).get(k2); }), caught(function () { return WeakMap.call(undefined); }), caught(function () { return Map.call(undefined); }));
  var m = new Map([[1, "a"]]), M2 = Map, S2 = Set;
  out.push(typeof Map, typeof Set, typeof WeakSet, Map === M2, new M2([[2, "b"]]).get(2), WeakMap === PossiblyWeakMap, m instanceof M2, Map.name, WeakSet.name, WeakMap.length);
  var sym = Symbol("s"), reg = Symbol.for("r"), wm = new WeakMap();
  out.push(caught(function () { wm.set(sym, 1); return wm.get(sym); }), caught(function () { return wm.set(reg, 1); }));
  out.push(Object.getOwnPropertyNames(new WeakMap()).length, Object.getPrototypeOf(new WeakMap()) === WeakMap.prototype, WeakMap.prototype.constructor === WeakMap);
  return out.join("|");
}
