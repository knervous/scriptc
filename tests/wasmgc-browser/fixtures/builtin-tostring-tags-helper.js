// Compiled builtin objects convert per spec: namespaces via Symbol.toStringTag, constructors via Function.prototype.toString.
/** @type {any} */
var AE = AggregateError;
/** @type {any} */
var D = Date;
export function run() {
  /** @type {any[][]} */
  var items = [
    ["JSON", JSON], ["Math", Math], ["Reflect", Reflect],
    ["Map", Map], ["Set", Set], ["WeakMap", WeakMap], ["WeakSet", WeakSet], ["Promise", Promise], ["Error", Error], ["TypeError", TypeError], ["RangeError", RangeError], ["AggregateError", AggregateError],
    ["Array", Array], ["Object", Object], ["Date", Date], ["Number", Number], ["String", String],
    ["Map.prototype", Map.prototype], ["Set.prototype", Set.prototype], ["Promise.prototype", Promise.prototype], ["Error.prototype", Error.prototype], ["TypeError.prototype", TypeError.prototype],
    ["WeakMap.prototype", WeakMap.prototype], ["WeakSet.prototype", WeakSet.prototype], ["Array.prototype", Array.prototype], ["Object.prototype", Object.prototype],
    ["Math.max", Math.max], ["JSON.stringify", JSON.stringify], ["Reflect.ownKeys", Reflect.ownKeys],
    ["Map.prototype.get", Map.prototype.get], ["Array.prototype.push", Array.prototype.push], ["map", new Map()], ["set", new Set()], ["wm", new WeakMap()], ["ws", new WeakSet()], ["promise", Promise.resolve(1)],
    ["mapIter", new Map().entries()], ["setIter", new Set().values()], ["arrIter", [1][Symbol.iterator]()], ["strIter", "a"[Symbol.iterator]()],
    ["err", new Error("e")], ["terr", new TypeError("t")], ["agg", new AE([], "a")],
    ["arr", [1, [2, 3]]], ["obj", {}], ["date", new D(0)], ["null", null], ["undef", undefined], ["num", 5], ["str", "s"], ["bool", true],
  ];
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var n = items[i][0], v = items[i][1], a, b, c;
    try { a = String(v); } catch (e) { a = "ERR " + e.name; }
    try { b = v + ""; } catch (e) { b = "ERR " + e.name; }
    try { c = Object.prototype.toString.call(v); } catch (e) { c = "ERR " + e.name; }
    out.push(n + " | " + a.replace(/\s+/g, " ").slice(0, 60) + " | " + b.replace(/\s+/g, " ").slice(0, 60) + " | " + c);
  }
  return out.join("\n");
}
