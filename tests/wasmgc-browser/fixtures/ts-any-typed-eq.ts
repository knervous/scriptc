// @native-any-only: constant-key reads through TS any are native dyn reads only in this lane (and class instances through any are a known defect in the others: defect-class-instance-through-any)
// `===` / `!==` against a constant-key dyn read: record number fields compare
// unboxed (NaN never equal, -0 equal to +0, a number never equal to a
// non-number); class instances, getters, dyn objects, arrays
// and missing keys keep the generic read, in source evaluation order.
// @hits(native-any): ^\$typed\.f64\.id$
class Box { id = 1; get twice() { return this.id * 2; } }
const rows: any[] = [{ id: 1, v: 0 }, { id: NaN, v: 1 }, { id: -0, v: 2 }, { id: 0, v: 3 }, { v: 4, id: 2.5 }];
const mixed: any[] = [{ id: "1" }, { id: true }, new Box(), { get id() { return 1; } }, JSON.parse('{"id":1}'), { name: "none" }, [1]];
const keys: any[] = [1, "1", NaN, 0, -0, 2.5, undefined, null, true, rows[0]];
const flags = (xs: any[], f: (r: any) => boolean) => xs.map((r) => f(r) ? "T" : "F").join("");
for (const k of keys) {
  console.log(String(k), flags(rows, (r) => r.id === k), flags(rows, (r) => k !== r.id), flags(mixed, (r) => r.id === k), flags(mixed, (r) => k === r.id));
}
// Evaluation order: the read happens before the other side, which may change state.
let n = 0;
const bump = (): any => { n++; return 1; };
console.log(rows[0].id === bump(), n, bump() === rows[0].id, n);
// Writes through dyn reach the record the comparison reads.
const row: any = rows[0];
row.id = 7;
console.log(row.id === 7, row.id === 1, rows.map((r: any) => r.id).join(","));
