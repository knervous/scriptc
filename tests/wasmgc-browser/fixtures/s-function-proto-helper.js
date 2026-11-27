function add(a, b) { return (this && this.k || 0) + a + b; }
export function run(fn) {
  var FP = Function.prototype;
  return [typeof FP.call, typeof FP.apply, typeof FP.bind, FP.call === fn.call, FP.apply === fn.apply, Object.getPrototypeOf(fn) === FP, FP.constructor === Function, fn.constructor === Function,
    FP.call.call(add, { k: 10 }, 1, 2), FP.apply.call(add, { k: 100 }, [1, 2]), FP.bind.call(add, { k: 1000 }, 1)(2), Function.prototype === Function.prototype, typeof Function,
    Object.getPrototypeOf(Function.prototype) === null || typeof Object.getPrototypeOf(Function.prototype)].join();
}
export var f = add;
