// A plain record stored in an unknown/dyn slot is the record itself (identity and mutation coupling survive): through a record field,
// a parameter, an array element, a Map value and a returned unknown.
type Box = { n: number };
const b: Box = { n: 1 };
const slot: { v: unknown } = { v: b };
b.n = 2;
console.log((slot.v as Box).n, slot.v === b);
function take(x: unknown): void { b.n += 1; console.log((x as Box).n, x === b); }
take(b);
const arr: unknown[] = [b];
b.n += 1;
console.log((arr[0] as Box).n, arr[0] === b);
(arr[0] as Box).n = 10;
console.log(b.n);
const m = new Map<string, unknown>([["k", b]]);
b.n = 11;
console.log((m.get("k") as Box).n, m.get("k") === b);
function ident(x: unknown): unknown { return x; }
console.log(ident(b) === b);
const anyslot: { v: any } = { v: b };
b.n = 12;
console.log(anyslot.v.n, anyslot.v === b);
const rec: Record<string, unknown> = { k: b };
b.n = 13;
console.log((rec.k as Box).n, rec.k === b);
