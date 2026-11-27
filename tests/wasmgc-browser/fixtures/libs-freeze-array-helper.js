// Sealed and frozen compiled arrays (immer's deep auto-freeze reaches arrays): writes,
// length changes and mutators refuse (arguments evaluate first), reads and copies work.
function attempt(f) { try { f(); return "ok"; } catch (e) { return e instanceof TypeError ? "TE" : "other"; } }
export function run() {
  var out = [], a = [3, 1, 2], s = [5, 4], order = [];
  Object.freeze(a);
  out.push(Object.isFrozen(a), Object.isSealed(a), Object.isExtensible(a), attempt(() => { a[0] = 9; }), a[0], attempt(() => a.push((order.push("arg"), 4))), order.join(), a.length,
    attempt(() => a.pop()), attempt(() => a.sort()), attempt(() => { a.length = 0; }), attempt(() => { a[5] = 1; }), a.join(), a.slice(1).join(), a.map(x => x * 2).join());
  Object.seal(s);
  out.push(Object.isSealed(s), Object.isFrozen(s), attempt(() => { s[0] = 7; }), s[0], attempt(() => s.push(1)), attempt(() => s.sort()), s.join(), Object.isSealed(s), attempt(() => { s[2] = 1; }), s.length);
  Object.freeze(s);
  out.push(Object.isFrozen(s), attempt(() => { s[0] = 1; }), s.join());
  var e = []; Object.freeze(e);
  out.push(Object.isFrozen(e), attempt(() => e.push(1)), e.length);
  return out.join("|");
}
