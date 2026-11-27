// @native-only: the engine model cannot pass the compiled Number/String/Boolean values across its any boundary
// A primitive held as any: its constructor IS the wrapper constructor value, callable with any argument.
function id(v: any): any { return v; }
console.log(id(5).constructor === Number, id("s").constructor === String, id(true).constructor === Boolean, id(5n).constructor === BigInt);
console.log(id(1.5).constructor === Number, id(NaN).constructor === Number, id("").constructor === String, id(false).constructor === Boolean);
console.log(id(5).constructor.name, id("s").constructor.name, id(true).constructor.name, id(5n).constructor.name);
const k = id(5).constructor;
console.log(k === id(Number), k("8"), k(8), id(String)(7), id(Boolean)(0), id(Number).name);
console.log(id(Number) === Number, id("x").constructor("y"), id(true).constructor(0));
