// Typed records, arrays and tuples handed to untyped code on the plain WasmGC lane: dyn reads see their fields and
// elements, nested values included, and an optional field left unset is not an own key.
function read(o: any, key: string): unknown {
  return o[key];
}
function keys(o: any): string[] {
  return Object.keys(o);
}
interface Item { name: string; qty: number; note?: string }
const item: Item = { name: "bolt", qty: 3 };
const order = { id: 7, items: [item, { name: "nut", qty: 5, note: "m4" }], tags: ["a", "b"], ok: true };
const pair: [string, number] = ["x", 2];
const held: any = order;
console.log(read(item, "name"), read(item, "qty"), read(item, "note"), keys(item).join(","));
console.log(held.id, held.ok, held.items.length, held.items[1].name, held.items[1].note, held.tags[1]);
console.log(keys(order).join(","), keys(held.items[1]).join(","));
const p: any = pair;
console.log(p[0], p[1], p.length);
