// `rec[k] ?? null` without noUncheckedIndexedAccess: the checker types an index read as present, so it types the whole
// `??` (and an unannotated binding of it) as the present type, while a missing key makes the value JS's null. The binding
// keeps `T | null`; its null tests, truthiness, optional chains and member reads behave as in JS (the touch hot bar's
// sparse saved slots, 10-25).
interface Btn { name: string }
const buttons: Record<number, Btn> = { 0: { name: "a" }, 9: { name: "b" } };
const counts: Record<string, number> = { a: 1 };
const list: Btn[] = [{ name: "x" }];
function pick(i: number): Btn | null { const d = buttons[i] ?? null; return d; }
function strict(i: number): string { const d = buttons[i] ?? null; return d === null ? "none" : d.name; }
function loose(i: number): string { const d = buttons[i] ?? null; return d == null ? "loose" : d.name; }
function truthy(i: number): string { const d = buttons[i] ?? null; if (!d) return "falsy"; return d.name; }
function chained(i: number): string { const d = buttons[i] ?? null; return d?.name ?? "chained"; }
function passes(i: number): string { const d = buttons[i] ?? null; return describe(d); }
function describe(b: Btn | null): string { return b === null ? "nil" : b.name; }
function count(k: string): number { return counts[k] ?? 0; }
function at(i: number): string { const b = list[i] ?? null; return b === null ? "none" : b.name; }
function member(i: number): string {
  const d = buttons[i] ?? null;
  try { return d.name; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; }
}
console.log(pick(0)?.name, pick(3));
console.log(strict(9), strict(4), loose(0), loose(5));
console.log(truthy(0), truthy(3), chained(9), chained(1));
console.log(passes(0), passes(3), count("a"), count("zz"), at(0), at(5));
console.log(member(0), member(2));
