// @options: {"interfaceClassArms": true}
// The array exit for page values: `x as any[]` / `x as any[] | undefined` of
// parsed JSON (glTF: `json.nodes as any[]`) copies the container and keeps
// the elements by identity; a typed-array union cast instance-checks each arm.
const h: any = globalThis;
const json: any = h.auditIdentity({
  items: [{ n: "a" }, { n: "b" }, 3, "s"],
  nums: [1, 2, 3],
  buf: new Float32Array([1.5, 2.5]),
  wide: new Float64Array([4.5]),
  none: undefined,
  text: "abc",
});
const items = json.items as any[];
console.log(items.length, items[0].n, items[1].n, items[2], items[3]);
let sum = 0;
for (const x of json.nums as any[]) sum += x;
console.log(sum);
// Elements keep identity with the page's.
const first = json.items[0];
console.log(items[0] === first, items[0] === json.items[1]);
const maybe = json.none as any[] | undefined;
console.log(maybe === undefined, (json.nums as any[] | undefined)?.length);
// Typed-array unions: per-arm instanceof, the value copied out.
const a = json.buf as Float32Array | Float64Array;
const b = json.wide as Float32Array | Float64Array;
console.log(a.length, a[0], a[1], b.length, b[0], a instanceof Float32Array, b instanceof Float64Array);
const s: any[] = [];
for (const k of json.items as any[]) s.push(typeof k);
console.log(s.join());
