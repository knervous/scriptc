// experimentalDynInlineSlots with constructor structs: a struct's anyref fields live in the
// inline slot fields (no unused inline fields), int fields after them; converting the object
// (expando, delete, a non-int in an int field, defineProperty, a setter defined mid-body)
// moves every property to its slot.
// @options: {"experimentalDynInlineSlots":3,"experimentalJsConstructorStructs":true}
// @native-only: both options are native-dyn compile options
// @hits(native,native-any): ^\$ctor\.demote$
import { run, mass } from "./js-inline-slots-structs-mixed-helper.js";
console.log(run());
console.log(mass());
