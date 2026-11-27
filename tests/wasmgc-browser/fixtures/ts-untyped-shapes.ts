// @native-only: the engine model emits an invalid module for a dyn method call on a JS object literal (a recorded engine-lane bug; native is the product lane)
// TS code over untyped values (what React Compiler leaves after stripping
// annotations): a dynamic key into a typed record, a tuple array entering
// JS, a promise-returning property method, `??` on an untyped value, pushing
// into an untyped `[]`, and a method-style call through a typed function value.
import { Service, totalSoFar, mapPairs, first } from "./ts-untyped-shapes-helper.js";
const LABELS: Record<string, string> = { always_need: "Always Need", never: "Never" };
const out: string[] = [];
function label(entry: any): string { return LABELS[entry.filter] ?? "(none)"; }
out.push(`labels ${label({ filter: "never" })} ${label({ filter: "zzz" })} ${label({ filter: 5 })}`);
const byKey = new Map<number, string>([[2, "b"], [1, "a"]]);
out.push(`pairs ${mapPairs([...byKey.entries()])}`);
const fallback = (x: any): any => x ?? "dflt";
out.push(`nullish ${fallback(undefined)} ${fallback(null)} ${fallback(0)} ${fallback("")}`);
const groups = new Map();
function add(id: number, name: string): void {
  const group = groups.get(id) ?? { name, entries: [] };
  group.entries.push({ id, name });
  groups.set(id, group);
}
add(1, "x"); add(1, "y"); add(2, "z");
out.push(`groups ${groups.get(1).name}:${groups.get(1).entries.length} ${groups.get(2).name}:${groups.get(2).entries.length} first ${first(groups.get(1).entries).name}`);
const ops = { twice(x: number): number { return x * 2; }, base: 3 };
out.push(`method ${ops.twice(4)} ${ops.twice(ops.base)}`);
const loot = Service.instance?.loot;
void loot?.decide(1, 2);
Promise.resolve().then(() => Promise.resolve()).then(() => {
  out.push(`promise method total ${totalSoFar()}`);
  console.log(out.join("\n"));
});
