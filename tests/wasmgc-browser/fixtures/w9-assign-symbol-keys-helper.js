// Object.assign copies enumerable symbol-keyed properties too (a compiled
// object keeps them on its page facade).
const tag = Symbol.for("w9.tag"), hidden = Symbol("hidden");
export function run() {
  const src = { label: "first", [tag]: "symbol" };
  Object.defineProperty(src, hidden, { value: 1, enumerable: false });
  const target = (v) => v + 1;
  const fn = Object.assign(target, src);
  const obj = Object.assign({}, src, { extra: 2 });
  return [fn[tag], fn.label, obj[tag], obj[hidden], Object.keys(obj).join(","), Object.getOwnPropertySymbols(obj).length, fn(1)].join(" ");
}
