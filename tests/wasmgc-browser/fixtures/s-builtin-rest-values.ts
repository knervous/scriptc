// Builtins with rest parameters stored as values and called with several arguments, spread, apply and call: the rest items are the call's arguments.
const max = Math.max, min = Math.min, hypot = Math.hypot, cp = String.fromCodePoint, assign: any = Object.assign, cc = String.fromCharCode;
console.log(max(1, 5, 3), min(4, 2, 9), hypot(3, 4), max(), min(), hypot());
console.log(JSON.stringify(cp(72, 105)), JSON.stringify(cp()), JSON.stringify(cc(72, 105)), JSON.stringify(cc()));
const nums = [3, 9, 4];
console.log(max(...nums), min(...nums), max.apply(null, nums), min.call(null, 8, 6, 7), hypot(...nums));
const target: any = { a: 1 };
const res = assign(target, { b: 2 }, { c: 3 }, { a: 4 });
console.log(res === target, JSON.stringify(target));
const plain: any = {};
console.log(JSON.stringify(assign(plain)));
