// Constructor structs typed from the site profile: a property a constructor sets from a parameter
// is an i32 field when the profile's field representation says V8 only saw Smis there. Values it
// cannot hold (strings, -0, fractions, 2^31, objects) convert the object, exactly as constant-typed
// fields do; int consumers (switch, ===, copies, flag words in locals) read the field unboxed.
// js-ctor-structs-profiled.profile.json: make-fixture-profile.mjs over the helper (fields
// tag,key,mode,flags,lanes,child; representations tag:s,key:h,mode:s,flags:s,lanes:s,child:h).
// @options: {"experimentalJsConstructorStructs":true,"experimentalJsSpecialize":"profile","experimentalJsSpecializeProfile":"fixtures/js-ctor-structs-profiled.profile.json"}
// @native-only: experimentalJsConstructorStructs and profile guards are native-dyn compile options
// @hits(native,native-any): ^\$ctor\.hit\.i32$
// @hits(native,native-any): ^\$ctor\.hit\.i32w$
// @hits(native,native-any): ^\$hit\.shadow\.switch$
// @hits(native,native-any): ^\$hit\.int\.eq$
// @hits(native,native-any): ^\$ctor\.demote$
// After a conversion, every other object of the constructor keeps its fast paths (its own shape says it is complete):
// @hits(native,native-any): ^\$hit\.ctor\.unclean$
import { make, kind, wide, flagsOf, isHost, copy, bump, setTag, setMode } from "./js-ctor-structs-profiled-helper.js";
const h: any = globalThis;
const run = (label: string): void => {
  const cells: any[] = [0, 1, 2, 3, 5, 6, 7, 8, 9, 30, -1, 2147483647].map((t, i) => make(t, [1, 1000, -5, 0][i % 4]));
  console.log(label, cells.map((c) => `${kind(c)}.${wide(c)}.${isHost(c)}`).join(" "));
  const a = cells[3], b = cells[4];
  b.flags = 7; b.lanes = 96;
  console.log(label, flagsOf(a), flagsOf(b), copy(a, b), bump(a, 3), bump(a, 3), bump(b, -2147483648), h.auditKeys(a));
};
run("clean");
// Values an i32 field cannot hold: each converts its object (and turns the fast paths off).
const s: any = make("5", 1), z: any = make(-0, 1), f: any = make(2.5, 1.5), o: any = make({ valueOf: () => 3 }, null);
console.log(kind(s), kind(z), Object.is(z.tag, -0), kind(f), wide(f), isHost(s), kind(o), wide(o), h.auditKeys(z), JSON.stringify(f));
const big: any = make(4, 1);
console.log(setTag(big, 2 ** 31), kind(big), setMode(big, -0), Object.is(big.mode, -0), setTag(big, 3), kind(big), JSON.stringify(big));
run("converted");
