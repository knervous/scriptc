// @native-any-only: checked casts of 'any' to undefined-armed record unions (the other lanes refuse them at compile time)
// TS `any` values cast back to nullable references: JavaScript's undefined
// takes the undefined arm and null the null arm, before any record arm.
import { describe, roundTrip, make } from "./tu-nullable-dyn-helper.js";
type Item = { id: number; name: string };
const mkItem = (id: number): Item => ({ id, name: "i" + id });
const items: (Item | null | undefined)[] = [mkItem(1), null, undefined, mkItem(2)];
const back = items.map(v => roundTrip(v) as Item | null | undefined);
console.log(back.map((v, i) => v === items[i]).join(","), back.map(v => v === null).join(","), back.map(v => v === undefined).join(","));
const recs = [make(0, 0) as Item | null | undefined, make(1, 1) as Item | null | undefined, make(2, 2) as Item | null | undefined];
console.log(recs.map(r => r === null ? "N" : r === undefined ? "U" : r.name + r.id).join(","));
const u1 = make(1, 6) as Item | undefined, u2 = make(2, 8) as Item | undefined;
console.log(u1 === undefined, u2?.name, describe(u1), describe(u2));
const anyOpt: any = items[0];
console.log((anyOpt as Item | undefined)?.name, (roundTrip(undefined) as Item | null | undefined) === undefined, (roundTrip(null) as Item | null | undefined) === null);
const sAny: any = "s", uAny: any = undefined, nAny: any = null;
const s1 = sAny as string | undefined, s2 = uAny as string | undefined, s3 = nAny as string | null, s4 = uAny as string | null | undefined;
console.log(s1, s2 === undefined, s3 === null, s4 === undefined, s4 === null);
