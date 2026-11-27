// A union that contains a list of itself, with a record arm whose field is that union again (JSX children over
// element records): built, walked, and held in an unknown slot. Same output as Node.
interface Element { readonly tag: string; readonly children: Children }
type Children = Element | string | null | readonly Children[];
function isList(c: Element | readonly Children[]): c is readonly Children[] { return Array.isArray(c); }
function count(c: Children): number {
  if (c === null) return 0;
  if (typeof c === "string") return 1;
  if (isList(c)) {
    let n = 0;
    for (const x of c) n += count(x);
    return n;
  }
  return 1 + count(c.children);
}
const tree: Children = [{ tag: "ul", children: [{ tag: "li", children: "a" }, null, [{ tag: "li", children: ["b", "c"] }]] }];
const slot: { v: unknown } = { v: tree };
console.log(count(tree), count(slot.v as Children));
export {};
