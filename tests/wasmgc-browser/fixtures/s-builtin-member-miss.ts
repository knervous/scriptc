// @options: {"hostHandles": true}
// @native-any-only: the any-typed compiled values and their inherited builtin members meet the page only in the native any model
// @native-refuses: a spec builtin member the program never names is not compiled into the build: a get is loud, never undefined
// @expect-native: true function false
// @expect-native: true builtin method 'findLast' is not compiled into this build
// @expect-native: true function false
// @expect-native: true builtin method 'get' is not compiled into this build
// A run-time-only key naming a spec builtin member: `in`, hasOwn and typeof still answer as the spec does; a get throws a TypeError.
const arr: any = [1, 2, 3];
const k = ["find", "Last"].join("");
console.log(k in arr, typeof arr[k], Object.prototype.hasOwnProperty.call(arr, k));
try { const f = arr[k]; console.log(typeof f); } catch (e: any) { console.log(e instanceof TypeError, e.message); }
const m: any = new Map([[1, 2]]);
const g = ["g", "et"].join("");
console.log(g in m, typeof m[g], Object.prototype.hasOwnProperty.call(m, g));
try { const f = m[g]; console.log(typeof f); } catch (e: any) { console.log(e instanceof TypeError, e.message); }
