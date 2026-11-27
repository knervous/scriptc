// Constant-key reads through TS any: record shapes declaring the key at
// different positions, a record without it, arrays and strings. The reads
// must reach the per-key typed reader and the shared outlined slow path:
// @hits(native-any): ^\$typed\.key\.id$
// @hits(native-any): ^\$dyn\.keyGet\.cold$
const a: any = { id: 1, name: "a" };
const b: any = { name: "b", extra: true, id: 2 };
const c: any = { name: "c" };
const rows: any[] = [a, b, c, { id: 4 }];
console.log(rows.map((r: any) => r.id).join(","), c.id === undefined, typeof c.toString);
let sum = 0; for (const r of rows) sum += r.id ?? 10; console.log(sum);
const arr: any = [5, 6, 7];
console.log(arr.length, arr["0"], arr["2"], arr["3"], arr["01"], arr["1.0"], arr.foo);
const s: any = "hello";
console.log(s.length, s.foo);
b.id = 20; console.log(b.id, rows[1].id);
const nested: any = { inner: { id: 9 } };
console.log(nested.inner.id, nested.missing?.id);
const bads: any[] = [undefined, null];
for (const x of bads) { try { console.log(x.id); } catch (e) { console.log(e instanceof TypeError, (e as Error).message); } console.log(x?.id); }
console.log(arr["4294967294"], arr["2147483648"], arr["-1"], arr.length + s.length);
