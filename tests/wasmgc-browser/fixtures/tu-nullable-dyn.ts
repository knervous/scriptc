// Nullable references crossing to untyped code and back (any, unknown, a
// JavaScript module): null and undefined keep their identity, a reference
// keeps its identity, and values coming back are checked against the union.
import { describe, roundTrip, make, nth, callIf } from "./tu-nullable-dyn-helper.js";
type Item = { id: number; name: string };
const mkItem = (id: number): Item => ({ id, name: "i" + id });
const items: (Item | null | undefined)[] = [mkItem(1), null, undefined, mkItem(2)];
console.log(items.map(v => describe(v)).join(","));
const opt: Item | undefined = items[0] ?? undefined;
const nul: Item | null = items[1] ?? null;
const anyOpt: any = opt, anyNul: any = nul, anyUndef: any = items[2];
const unk: unknown = nul, unk2: unknown = items[2];
console.log(anyOpt.id, anyNul === null, anyNul === undefined, anyUndef === undefined, unk === null, unk2 === undefined, typeof anyNul, typeof unk2, typeof anyOpt);
const fromAny = anyNul as Item | null, fromAny2 = anyOpt as Item | null;
console.log(fromAny === null, fromAny2?.name, describe(roundTrip(nul)), describe(roundTrip(opt)), describe(roundTrip(items[2])));
// Records arriving from JavaScript as null or a record.
const r1 = make(0, 5) as Item | null, r3 = make(2, 7) as Item | null;
console.log(r1 === null, r3?.name, describe(r3), r1 ?? "dflt");
// Lists and callbacks.
const list: (Item | null)[] = [mkItem(3), null];
console.log(describe(nth(list, 0)), describe(nth(list, 1)), describe(nth(list, 5)));
const f: ((n: number) => string) | undefined = items.length > 3 ? (n => "f" + n) : undefined;
const g: ((n: number) => string) | null = items.length > 9 ? (n => "g" + n) : null;
console.log(callIf(f, 1), callIf(g, 2), callIf(undefined, 3));
const json = JSON.parse(JSON.stringify({ a: null, b: { id: 1, name: "x" } }));
const ja: Item | null = json.a, jb: Item | null = json.b;
console.log(ja === null, jb?.name, JSON.stringify([ja, jb]));
