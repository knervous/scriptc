// WeakMap / WeakSet on the web host: real page weak collections, compiled keys by identity.
/** @type {any} */ var WM = WeakMap;
/** @type {any} */ var WS = WeakSet;
export function run() {
  var out = [];
  var wm = new WM(), ws = new WS(), keys = [];
  for (var i = 0; i < 200; i++) { var k = { id: i }; keys.push(k); wm.set(k, i * 2); if (i % 2 === 0) ws.add(k); }
  var ok = 0, mapOk = 0, setOk = 0;
  for (var j = 0; j < 200; j++) { if (wm.get(keys[j]) === j * 2) mapOk++; if (ws.has(keys[j]) === (j % 2 === 0)) setOk++; if (wm.has(keys[j])) ok++; }
  out.push([mapOk, setOk, ok, wm.has({ id: 0 }), wm.get({ id: 1 }), ws.has({})].join());
  var gone = keys[7];
  out.push([wm.delete(gone), wm.has(gone), wm.get(gone), wm.delete(gone), ws.delete(keys[8]), ws.has(keys[8]), ws.delete(keys[9])].join());
  gone.id = 70; out.push(gone.id, keys[7] === gone, wm.set(gone, "back") === wm, wm.get(gone));
  var fn = function () {}; var arr = [1]; var cls = new Error("e");
  wm.set(fn, "fn"); wm.set(arr, "arr"); wm.set(cls, "cls"); ws.add(fn); ws.add(arr);
  out.push([wm.get(fn), wm.get(arr), wm.get(cls), ws.has(fn), ws.has(arr), ws.has(cls)].join());
  var bad = [1, "s", true, null, undefined, Symbol.for("reg")];
  var rejected = bad.map(function (b) { var r = ""; try { wm.set(b, 1); r += "set-ok"; } catch (e) { r += e.name; } try { ws.add(b); r += "/add-ok"; } catch (e) { r += "/" + e.name; } return r + ":" + wm.has(b) + ws.has(b) + wm.get(b) + wm.delete(b); });
  out.push(rejected.join("|"));
  var sym = Symbol("local"); out.push([wm.set(sym, "sym") === wm, wm.get(sym), ws.add(sym) === ws, ws.has(sym)].join());
  var seeded = new WM([[keys[1], "one"], [keys[2], "two"]]), seededSet = new WS([keys[3], keys[4]]);
  out.push([seeded.get(keys[1]), seeded.get(keys[2]), seeded.has(keys[3]), seededSet.has(keys[3]), seededSet.has(keys[5])].join());
  try { new WM([[1, 2]]); out.push("no throw"); } catch (e) { out.push(e.name); }
  out.push([wm instanceof WM, ws instanceof WS, wm instanceof WS, ws instanceof WM, Object.prototype.toString.call(wm), String(ws), typeof wm, typeof WM].join());
  var proto = Object.getPrototypeOf(wm); out.push([proto !== null, typeof wm.get, typeof ws.add, WM.name, WM.length].join());
  try { wm.get.call({}, keys[0]); out.push("no throw"); } catch (e) { out.push(e.name); }
  var shared = { v: 1 }, a = new WM(), b = new WM(); a.set(shared, "a"); b.set(shared, "b");
  out.push([a.get(shared), b.get(shared), a.delete(shared), a.has(shared), b.has(shared)].join());
  return out.join("\n");
}
