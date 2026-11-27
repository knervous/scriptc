var O = Object;
var plain = { a: 1, b: 2 };
export function probe() {
  return [typeof Object, typeof O, O === Object, O.name, O.length, typeof Object.keys, Object.keys === O.keys, Object.assign === O.assign, Object.is === O.is, Object.entries === O.entries, Object.freeze === O.freeze];
}
export function statics() {
  var keys = O.keys, values = O.values, entries = O.entries, assign = O.assign, create = O.create;
  var made = create({ inherited: 1 });
  made.own = 2;
  return [keys(plain).join(), values(plain).join(), entries(plain).join("|"), assign({}, plain, { c: 3 }).c, O.getPrototypeOf(made).inherited, O.getOwnPropertyNames(made).join(), O.isFrozen(O.freeze({})), O.fromEntries([["k", 1]]).k];
}
export function ctor() {
  var o = {}, same = O(o), fresh = O(), viaNew = new O(), nul = O(null);
  return [same === o, typeof fresh, Object.keys(fresh).length, typeof viaNew, typeof nul, o instanceof O, [] instanceof O, (function () {}) instanceof O];
}
export function viaConstructor() {
  return [plain.constructor === O, plain.constructor === Object, {}.constructor.name, Object.keys(O).length, "keys" in O, Object.getOwnPropertyNames(O).indexOf("keys") >= 0];
}
