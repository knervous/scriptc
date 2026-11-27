// @native-any-only: `x as Record` of a value that entered unknown by reference is the record itself (an identity test, no copy), for
// plain-data records, records with function/symbol/optional/recursive fields, arrays and unions of them; a value of another shape fails
// with the catchable TypeError.
type Box = { n: number };
type Queue = { pending: Box | null; cb: () => number; tag: number | symbol; next: Queue | null; hooks?: Array<() => void> | null };
const box: Box = { n: 1 };
const q: Queue = { pending: box, cb: () => 7, tag: 3, next: null };
const u: unknown = box;
const uq: unknown = q;
console.log((u as Box) === box, (uq as Queue) === q, (uq as Queue).cb(), (uq as Queue).pending === box);
const list: unknown[] = [q, q];
console.log((list[1] as Queue) === q, list.length);
const maybe: unknown = null;
console.log((maybe as Queue | null) === null);
const wrongShape: unknown = { other: true };
try { console.log((wrongShape as Queue).cb()); } catch (e) { console.log("failed", e instanceof TypeError); }
const holder: { updateQueue: unknown } = { updateQueue: q };
(holder.updateQueue as Queue).next = q;
console.log((holder.updateQueue as Queue).next === q);
