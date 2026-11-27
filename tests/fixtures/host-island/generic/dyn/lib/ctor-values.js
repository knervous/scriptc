// The JavaScript half of ctor-values.ts: builtin constructors read as values (only JavaScript sources may).
export function kinds() {
  const kind = (c) => `${typeof c}:${c.name}:${c.length}`;
  return [kind(Array), kind(Object), kind(Symbol)].join(" ");
}
export function arrays(list, plain) { return arraysOf(Array, list, plain); }
function arraysOf(A, list, plain) {
  return [A.isArray(list), A.isArray(plain), A.of(3, 4).length, A.from(list).length, list instanceof A, list.constructor === A].join(" ");
}
export function objects(keyed) { return objectsOf(Object, keyed); }
function objectsOf(O, keyed) {
  return [O.keys(keyed).join(","), O.is(NaN, NaN), O.is(0, -0), typeof O.assign, typeof O.prototype,
    typeof O(), O(keyed) === keyed, JSON.stringify(new O()), Object.keys(O).length].join(" ");
}
export function symbols() { return symbolsOf(Symbol); }
function symbolsOf(Sym) {
  const s1 = Sym("d");
  return [typeof s1, typeof Sym.iterator, typeof Sym.for, Sym.for("k") === Sym.for("k"), Sym.keyFor(Sym.for("k"))].join(" ");
}
