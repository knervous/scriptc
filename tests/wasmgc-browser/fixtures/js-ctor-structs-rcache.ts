// Receiver caches over constructor-struct sites (profile + constructor structs): a later site on the
// same local reads or writes the field after one null test while nothing could have redefined the
// local or converted an object; redefinitions, conversions in callees and in the value of a write
// all fall back to the tested paths.
// js-ctor-structs-rcache.profile.json: make-fixture-profile.mjs over the helper (fields
// tag,lanes,val,next; representations tag:s,lanes:s,val:h,next:h).
// @options: {"experimentalJsConstructorStructs":true,"experimentalJsSpecialize":"profile","experimentalJsSpecializeProfile":"fixtures/js-ctor-structs-rcache.profile.json"}
// @native-only: experimentalJsConstructorStructs and profile guards are native-dyn compile options
// @hits(native,native-any): ^\$ctor\.hit\.read$
// @hits(native,native-any): ^\$ctor\.hit\.i32$
// @hits(native,native-any): ^\$hit\.ctor\.cached$
import { make, drop, walk, across, swapWrite, swapWriteF, swapRead, widen } from "./js-ctor-structs-rcache-helper.js";
const list = (n: number): any => { let l: any = null; for (let i = n; i > 0; i--) l = make(i, "v" + i, l); return l; };
const l: any = list(5);
console.log(walk(l), walk(l));
const a: any = make(1, "a", null), b: any = make(2, "b", null);
console.log(across(a, (o: any) => { o.extra = "x"; }), across(b, (_o: any) => {}), across(make(4, "c", null), drop));
const c: any = make(5, "c", null), d: any = make(6, "d", null);
console.log(swapWrite(c, d), c.lanes, d.lanes, swapWriteF(c, d), c.lanes, d.lanes, swapRead(c, d));
console.log(widen(make(7, "w", null), 3), widen(make(8, "w", null), "s"), widen(make(9, "w", null), 2.5));
// Everything again after conversions turned the clean flags off.
const l2: any = list(4);
console.log(walk(l2), across(make(1, "e", null), (_o: any) => {}), swapWrite(make(3, "f", null), make(4, "g", null)), swapRead(make(5, "h", null), make(6, "i", null)));
