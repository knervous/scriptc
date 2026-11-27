// structuredClone of compiled records, arrays, nested values and optional fields:
// a deep copy, independent of the original.
interface Inner { tags: string[]; weight: number }
interface Item { id: number; name: string; inner: Inner; note?: string; flags: boolean[] }
const a: Item = { id: 1, name: "a", inner: { tags: ["x", "y"], weight: 1.5 }, flags: [true, false] };
const b = structuredClone(a);
b.inner.tags.push("z");
b.name = "b";
b.note = "n";
b.flags[0] = false;
console.log(a.name, a.inner.tags.join(), a.note, a.flags.join(), a.id);
console.log(b.name, b.inner.tags.join(), b.note, b.flags.join(), b.inner.weight);
const list = structuredClone([a, b]);
list[0]!.id = 99;
console.log(a.id, list[0]!.id, list.length, list[1]!.name);
const nums = structuredClone([1, 2, 3]);
nums.push(4);
console.log(nums.join());
const maybe: Item | undefined = list.length > 5 ? a : undefined;
const un = structuredClone(maybe);
console.log(un === undefined, structuredClone(list.length > 0 ? a : undefined)?.name);
