// Record and tuple facades of one shape at once: page reads, writes,
// expandos, a delete (adopting one record), a freeze (adopting the other),
// then identity and the compiled side's view of each after the page's changes.
type Rec = { n: number; label: string };
const h: any = globalThis;
const r1: Rec = { n: 1, label: "a" }, r2: Rec = { n: 2, label: "b" };
const t1: [number, string] = [1, "x"], t2: [number, string] = [2, "y"];
console.log(h.auditRecordPair(r1, r2, t1, t2));
const kept: any = h.auditRecordPairKept();
console.log(kept[0] === r1, kept[1] === r2, kept[0] === r2);
console.log(r1.n, r1.label, r2.n);
r2.n = 30;
console.log(h.auditRecordPairKept()[1].n, r2.n);
