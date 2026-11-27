// @options: {"interfaceClassArms": true}
// A conditional object literal normalizes to `{a; b} | {a; b?: undefined}`; both arms flow into a slot
// declared `{a; b?}` that a wider record also flows into.
interface Item { idfile: string; itemId: number; material: number; name: string; weight: number }
class Holder {
  private bow: { idfile: string; itemId?: number; material?: number } | null = null;
  take(worn: Item | null): string {
    const next = worn?.idfile
      ? { idfile: worn.idfile, itemId: worn.itemId, material: worn.material }
      : { idfile: "default" };
    this.bow = next;
    return `${this.bow.idfile}:${this.bow.itemId ?? "none"}:${this.bow.material ?? "none"}`;
  }
  adopt(item: Item): string {
    this.bow = item;
    return this.bow.idfile + ":" + String(this.bow.itemId);
  }
}
const h = new Holder();
const item: Item = { idfile: "bow01", itemId: 7, material: 3, name: "Bow", weight: 2 };
console.log(h.take(item));
console.log(h.take(null));
console.log(h.adopt(item));
