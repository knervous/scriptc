// @native-only: the engine dyn model keeps its fence for array iterators used as values
// arr.entries() / keys() / values() as values: spread, Array.from, a stored iterator, manual next(), for-of, destructuring.
const letters = ["a", "b", "c"];
console.log([...letters.entries()].join(";"), [...letters.keys()].join(), [...letters.values()].join());
console.log(Array.from(letters.entries()).length, Array.from(letters.keys(), (i) => i * 2).join(), Array.from(letters.values(), (s) => s + s).join());
const it = letters.entries();
const first = it.next();
console.log(first.done, first.value!.join(), it.next().value![1], it.next().value![0], it.next().done);
for (const [i, s] of letters.entries()) console.log(i, s);
const pairs = [...letters.entries()];
const [[i0, s0], [i1]] = pairs;
console.log(i0, s0, i1);
const numbers = new Float64Array([1.5, 2.5]);
console.log([...numbers.entries()].join(";"), [...numbers.keys()].join(), [...numbers.values()].join());
console.log(Math.max(...[10, 20, 30].keys()));
