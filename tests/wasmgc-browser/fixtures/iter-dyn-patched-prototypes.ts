// @native-any-only: untyped iteration as TS any (the engine and plain native lanes keep these values in the page)
// (not a hostHandles fixture: the native host has no page prototypes to patch)
// A patched Symbol.iterator on the page prototypes of Array, String, Map and Set is honoured (restored after each case).
const g: any = globalThis;
const plain: any = [7, 8];
const text: any = "hey";
const map: any = new Map<any, any>([[1, 2]]);
const set: any = new Set<any>([5]);
// The prototype is patched only while the values are collected: the report itself iterates.
const patch = (proto: any, make: () => any, run: () => any[]): string => {
  const saved = proto[Symbol.iterator];
  proto[Symbol.iterator] = make();
  let out: any[];
  try { out = run(); } finally { proto[Symbol.iterator] = saved; }
  return JSON.stringify(out);
};
console.log(patch(g.Array.prototype, () => function* () { yield "A"; }, () => { const r = [...plain]; const s = Array.from(plain as any); return [r, s]; }));
console.log(patch(g.String.prototype, () => function* () { yield "S"; }, () => [...text]));
console.log(patch(g.Map.prototype, () => function* () { yield "M"; }, () => [...map]));
console.log(patch(g.Set.prototype, () => function* () { yield "T"; }, () => [...set]));
console.log(JSON.stringify([...plain]), JSON.stringify([...text]), JSON.stringify([...map]), JSON.stringify([...set]));

