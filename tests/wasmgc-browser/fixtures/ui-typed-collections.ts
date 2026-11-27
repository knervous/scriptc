// Typed collection paths the crafting window's conformant patterns take:
// new Map(map) copies live entries in insertion order; sort moves a typed
// array's holes to the end (arrayDelete); Object.entries
// over a total Record whose values are string | number | readonly string[]
// (not an HTTP header slot); Intl is the page's own in the browser target.
const picks = new Map<number, string>([[3, "charcoal"], [0, "ore"]]);
const copy = new Map(picks);
copy.set(1, "flux");
copy.delete(3);
console.log([...picks].join(";"), "|", [...copy].join(";"), copy === picks);
const set = new Set<string>(["a", "b"]);
const set2 = new Set(set);
set2.add("c");
console.log(set.size, set2.size, [...set2].join(","));

const slots: number[] = [5, 3];
slots[5] = 1; // a write past the end leaves holes at 2..4
slots.sort((a, b) => a - b);
console.log(slots.length, 2 in slots, 3 in slots, JSON.stringify(slots));

type PlainArg = string | number | readonly string[];
const args: Readonly<Record<string, PlainArg>> = { name: "Bronze Blade", count: 3, list: ["the binding", "half the core"] };
for (const [name, value] of Object.entries(args)) console.log(name, typeof value, Array.isArray(value) ? value.length : value);

const lang = ["en", "de"][0]!;
console.log(new Intl.NumberFormat(lang).format(1234.5));
console.log(new Intl.PluralRules(lang).select(1), new Intl.PluralRules(lang).select(3));
console.log(new Intl.ListFormat(lang, { type: "conjunction" }).format(["ore", "flux", "coal"]));

// An optional callback prop, narrowed and called (`onWork?: (key) => void`).
function work(props: { title: string; onWork?: (recipeKey: string) => void; onPick?: ((slot: number) => number) | null }): void {
  if (props.onWork) props.onWork(`${props.title}:r12`);
  else console.log("no work", props.title);
  console.log(props.onPick ? props.onPick(3) : "no pick");
}
work({ title: "a", onWork: (key) => console.log("work", key), onPick: (slot) => slot * 2 });
work({ title: "b", onPick: null });
