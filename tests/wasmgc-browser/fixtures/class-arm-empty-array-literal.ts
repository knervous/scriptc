// @options: {"interfaceClassArms": true}
// A fresh object literal with an empty array literal flows into an interface slot
// whose union also has class arms.
interface Bag { items: number[]; name: string }
class Sack implements Bag { items: number[] = [1, 2]; name = "sack"; }
class Box implements Bag { items: number[] = []; name = "box"; }
function describe(b: Bag): string { return `${b.name}:${b.items.length}`; }
const slots: Bag[] = [new Sack(), new Box(), { items: [], name: "lit" }, { items: [7], name: "lit7" }];
console.log(slots.map(describe).join(" "));
let held: Bag = new Box();
held = { items: [], name: "assigned" };
console.log(describe(held));
function make(n: number): Bag { return n > 0 ? { items: [], name: "m" + n } : new Sack(); }
console.log(describe(make(1)), describe(make(0)));
interface Wrap { inner: Bag; tags: string[] }
const w: Wrap = { inner: { items: [], name: "in" }, tags: [] };
console.log(describe(w.inner), w.tags.length);
// A literal bound first (its array element type is inferred), then flowing in.
const lit = { items: [], name: "bound" };
const viaConst: Bag = lit;
console.log(describe(viaConst));
const list: Bag[] = [];
list.push({ items: [], name: "pushed" });
list.push(lit);
console.log(list.map(describe).join(" "));
const maybe = (flag: boolean): Bag => flag ? { items: [], name: "t" } : { items: [3], name: "f" };
console.log(describe(maybe(true)), describe(maybe(false)));
const opt: { b?: Bag } = { b: { items: [], name: "opt" } };
console.log(opt.b ? describe(opt.b) : "none");
