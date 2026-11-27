// An array element bound by for-of (over an array literal or an array) is typed `T | undefined` once lowered, as are
// `find`/`at` results, Map lookups and optional fields. Each such value passed into an `unknown` slot and cast back
// (`input as T`) must be the same object, as the same `T` passed directly is: identity, Set/Map/WeakMap keys and
// writes in both directions all hold. The same holds for a record or array reaching `unknown` through a strict
// equality, a ternary, an `unknown` index signature, a promise reaction, a delegated generator's sent value and a
// diagnostics_channel message.
import * as dc from "node:diagnostics_channel";

interface Item {
  readonly name: string;
  hits: number;
}
const a: Item = { name: "a", hits: 0 };
const b: Item = { name: "b", hits: 0 };
const live = new Set<Item>([a, b]);
const labels = new WeakMap<Item, string>([[a, "A"], [b, "B"]]);
const order = new Map<Item, number>([[a, 0], [b, 1]]);

function describe(input: unknown): string {
  const item = input as Item;
  return `${item.name} same=${item === a || item === b} live=${live.has(item)} label=${labels.get(item)} order=${order.get(item)}`;
}
function touch(input: unknown): void {
  (input as Item).hits++;
}

// for-of over an array literal and over an array.
for (const item of [a, b]) console.log("literal", describe(item));
const items: Item[] = [a, b];
for (const item of items) console.log("array", describe(item));
for (const item of items) touch(item);
console.log("writes through", a.hits, b.hits);
for (const item of items) {
  const held: unknown = item;
  a.hits = 10;
  console.log("writes back", (held as Item).hits === item.hits);
}
let index = 0;
for (const item of items) {
  const held: unknown = item;
  console.log("index loop agrees", items[index++] === (held as Item));
}

// Arrays as elements: the element array itself, and pushes through it.
const groups: Item[][] = [items, [b]];
for (const group of groups) {
  const held: unknown = group;
  console.log("group", (held as Item[]) === items || (held as Item[]) === groups[1], (held as Item[]).length);
}
for (const group of groups) {
  const held: unknown = group;
  if ((held as Item[]) !== items) (held as Item[]).push(a);
}
console.log("pushed", groups[1]!.length, groups[1]![1] === a);

// Other `T | undefined` producers.
console.log("find", describe(items.find((item) => item.name === "b")));
console.log("at", describe(items.at(0)));
const byName = new Map<string, Item>([["a", a]]);
console.log("map get", describe(byName.get("a")));
interface Slot {
  item?: Item;
  other: Item | null;
}
const slot: Slot = { item: a, other: b };
console.log("optional field", describe(slot.item));
console.log("nullable field", describe(slot.other));
items.forEach((item) => console.log("forEach", describe(item)));
for (const [key, item] of byName) console.log("map entries", key, describe(item));

// Strict equality of an unknown against a union-typed element.
const known: unknown = a;
for (const item of items) console.log("equal", known === item, known !== item);
console.log("equal find", known === items.find((item) => item.hits === 10));

// A ternary of references into unknown.
const pick: unknown = items.length > 1 ? b : 0;
console.log("ternary", describe(pick));

// An unknown index signature built from a literal.
const bag: Record<string, unknown> = { first: a, list: items };
console.log("bag", describe(bag["first"]), (bag["list"] as Item[]) === items);

// A record copied into an unknown index signature.
type Pair = { left: Item; right: Item };
const pair: Pair = { left: a, right: b };
function rightOf(record: { [key: string]: unknown }): unknown {
  return record["right"];
}
console.log("width", describe(rightOf(pair)));

// A sent value forwarded through yield*.
function* inner(): Generator<number, void, unknown> {
  const sent: unknown = yield 1;
  console.log("generator", describe(sent));
}
function* outer(): Generator<number, void, unknown> {
  yield* inner();
}
const generator = outer();
generator.next();
generator.next(items.find((item) => item.name === "a"));

// A diagnostics_channel message reaches its subscribers as itself.
const channel = dc.channel("union-element-unknown-identity");
channel.subscribe((message) => {
  (message as Item).hits = 7;
  console.log("channel", describe(message));
});
channel.publish(items.find((item) => item.name === "b"));
console.log("channel write", b.hits);

// A promise reaction taking unknown.
const react: (value: unknown) => void = (value) => console.log("then", describe(value));
void Promise.resolve(items.at(1)).then(react);

// Registries keyed by the recovered value.
const seen = new Set<unknown>();
for (const item of items) seen.add(item);
console.log("seen", seen.has(a), seen.has(b), seen.size);
const recovered: Item[] = [];
for (const item of [b, a]) {
  const held: unknown = item;
  recovered.push(held as Item);
}
console.log("recovered", recovered[0] === b, recovered[1] === a, live.has(recovered[0]!));
live.delete(a);
for (const item of items) console.log("after delete", describe(item));
