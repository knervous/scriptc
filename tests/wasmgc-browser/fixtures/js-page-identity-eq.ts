// Strict equality between a page object read back out of a record held in a
// Map (dyn-held) and one held directly: identity, both ways, and against a
// different object of the same kind.
const h: any = globalThis;
const doc: Document = h.auditDom().doc;
interface Slot { el: HTMLElement; extra: HTMLElement | null; label: string }
const slots = new Map<string, Slot>();
function remember(id: string, el: HTMLElement): void {
  slots.set(id, { el, extra: null, label: id });
}
function holds(id: string, el: HTMLElement): boolean {
  const existing = slots.get(id);
  return existing?.el === el;
}
function differs(id: string, el: HTMLElement): boolean {
  const existing = slots.get(id);
  return existing !== undefined && existing.el !== el;
}
const a = doc.createElement("div");
const b = doc.createElement("div");
remember("a", a);
console.log(holds("a", a), holds("a", b), holds("missing", a));
console.log(differs("a", a), differs("a", b), differs("missing", b));
remember("a", b);
console.log(holds("a", a), holds("a", b));
