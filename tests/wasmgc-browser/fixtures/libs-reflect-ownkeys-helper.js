var sym = Symbol.for("libs-s");
export function run() { var o = { b: 1, a: 2 }; o[sym] = 3; Object.defineProperty(o, "h", { value: 4, enumerable: false }); return Reflect.ownKeys(o).length + ":" + Reflect.ownKeys([1, 2]).join(","); }
