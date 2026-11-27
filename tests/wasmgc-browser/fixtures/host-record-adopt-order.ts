// A page adds keys (string, symbol, index) to a compiled record and then
// reshapes it (delete, freeze): Object.keys keeps JS order, fields first.
type Rec = { n: number; label: string; ok: boolean };
const h: any = globalThis;
const r: Rec = { n: 1, label: "a", ok: true }, s: Rec = { n: 2, label: "b", ok: false };
console.log(h.auditRecordAdoptOrder(r, s));
console.log(r.n, r.ok, s.n, s.label, s.ok);
