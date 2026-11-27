// @options: {"hostHandles": true}
// @native-any-only: the any-typed compiled values and their inherited builtin members meet the page only in the native any model
// Builtin members called through their closure value take exactly their arguments: variadic members (push, unshift, concat, splice,
// toSpliced, call, bind) take any number, fixed-arity members read their declared parameters (a builtin ignores the rest).
import { fn as fnHelper } from './s-builtin-arity-helper.js';
const mk = (): any => [1, 2, 3];
const a: any = mk();
const push = a.push, unshift = a.unshift, concat = a.concat, splice = a.splice, toSpliced = a.toSpliced, fill = a.fill, slice = a.slice;
console.log(push.call(a, 4, 5, 6, 7, 8, 9), a.join());
console.log(unshift.apply(a, [-3, -2, -1, 0, 0.5, 0.75]), a.join());
console.log(concat.call([0], 1, [2], [3], 4, [5, 6], 7).join());
const b: any = mk();
console.log(splice.call(b, 1, 1, "a", "b", "c", "d", "e").join(), b.join());
console.log(splice.call(b, -2, 2).join(), b.join(), splice.call(b).length, splice.call(b, 1).join(), b.join());
const c: any = mk();
console.log(toSpliced.call(c, 1, 1, "x", "y", "z", "w", "v").join(), c.join(), toSpliced.call(c, 0, 1).join());
console.log(fill.call(mk(), 9, 1, 3).join(), slice.call([1, 2, 3, 4], 1, 3, "extra", "more").join());
const reduce = a.reduce, lastIndexOf = a.lastIndexOf, indexOf = a.indexOf, map = a.map;
console.log(reduce.call([1, 2, 3], (x: number, y: number) => x + y), reduce.call([1, 2, 3], (x: number, y: number) => x + y, 10), lastIndexOf.call([1, 2, 1], 1), lastIndexOf.call([1, 2, 1], 1, 1));
console.log(indexOf.call([1, 2, 3, 2], 2, 2), map.call([1, 2], (x: number) => x * 2, undefined, 1, 2, 3, 4, 5, 6).join());
const fn: any = fnHelper;
const call = fn.call, bind = fn.bind, apply = fn.apply;
console.log(call.call(fn, { k: "K" }, 1, 2, 3, 4, 5, 6, 7), call.call(fn, null), call.call(fn, { k: "J" }, 1));
const bound = bind.call(fn, { k: "B" }, 1, 2, 3, 4, 5, 6);
console.log(bound(7, 8, 9), bind.call(fn, { k: "C" })(1, 2, 3, 4, 5, 6), apply.call(fn, { k: "A" }, [1, 2, 3, 4, 5, 6], "ignored"));
const m: any = new Map([[1, 2]]);
const set = m.set, get = m.get;
console.log(set.call(m, 3, 4, 5, 6, 7, 8) === m, get.call(m, 3, "x", "y", "z", "w", "v"), m.size);
const num: any = 255, tostr = num.toString;
console.log(tostr.call(255, 16, 1, 2, 3, 4, 5), tostr.call(255), tostr.call(255, 2));
