// Identity of registered and well-known symbols, observed through property keys (=== on symbols has no lowering yet).
export function run() {
  const a = Symbol.for("abiR.key");
  const key = ["abiR", "other"].join(".");
  const o = { [a]: 1 };
  o[Symbol.for(key)] = 2;
  o[Symbol.iterator] = 3;
  const out = [o[Symbol.for("abiR.key")], o[Symbol.for("abiR." + "key")], o[Symbol.for("abiR.other")], typeof o[Symbol.for("abiR.nope")]];
  out.push(o[Symbol.iterator], typeof o[Symbol.asyncIterator], Object.getOwnPropertySymbols(o).length);
  out.push(typeof Symbol.toPrimitive);
  return out.join(",");
}
