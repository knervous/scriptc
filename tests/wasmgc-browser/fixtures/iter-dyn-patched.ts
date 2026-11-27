// @options: {"hostHandles": true}
// @native-any-only: untyped iteration as TS any (the engine and plain native lanes keep these values in the page)
// A patched Symbol.iterator is honoured: an own method on a compiled object, an own method on an
// array (the page prototypes are patched in iter-dyn-patched-prototypes).
const mk = (): any => ({ a: 1, [Symbol.iterator]() { let i = 0; return { next: () => (i < 2 ? { value: 10 * ++i, done: false } : { value: undefined, done: true }) }; } });
const o = mk();
console.log(JSON.stringify([...o]));
o[Symbol.iterator] = function () { let n = 0; return { next: () => (n < 2 ? { value: "p" + n++, done: false } : { value: undefined, done: true }) }; };
console.log(JSON.stringify([...o]), JSON.stringify(Array.from(o as any)));
const arr: any = [1, 2, 3];
arr[Symbol.iterator] = function* () { yield "own"; };
console.log(JSON.stringify([...arr]));
const plain: any = [7, 8];
const text: any = "hey";
const map: any = new Map<any, any>([[1, 2]]);
const set: any = new Set<any>([5]);
console.log(JSON.stringify([...plain]), JSON.stringify([...text]), JSON.stringify([...map]), JSON.stringify([...set]));
