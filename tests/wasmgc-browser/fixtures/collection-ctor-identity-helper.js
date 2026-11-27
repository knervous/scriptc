export function run() {
  var g = globalThis, out = [];
  var PW = g.WeakMap, PM = g.Map, PS = g.Set, PWS = g.WeakSet;
  out.push(PW === WeakMap, PM === Map, PS === Set, PWS === WeakSet, WeakMap === PW);
  out.push(Map.prototype === PM.prototype, Object.getPrototypeOf(new Map()) === PM.prototype);
  var pw = new PW(), k = {};
  pw.set(k, 5);
  out.push(pw instanceof WeakMap, pw.get(k), new WeakMap() instanceof PW, new Map() instanceof PM, new PM() instanceof Map, new PS([1]) instanceof Set);
  var cw = new WeakMap(); cw.set(k, 6);
  out.push(cw.get(k), cw instanceof WeakMap, typeof g.WeakMap, g.WeakMap.name);
  return out.join("|");
}
