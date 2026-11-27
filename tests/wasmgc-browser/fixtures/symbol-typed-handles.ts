// @options: {"hostHandles": true}
// @native-only: typed symbols have no engine-dyn lowering
const a = Symbol("x"), b = Symbol();
console.log(a.toString(), a.description, b.description, Symbol.keyFor(Symbol.for("k")), Symbol.keyFor(a), Symbol.keyFor(Symbol.iterator));
