// Literal structs: object literals sharing a key list are structs when the site profile saw that
// layout. Every generic operation keeps JS semantics (key order, enumeration, spread, JSON, `in`,
// prototype); anything the fields cannot represent (an expando, a delete, freezing, an accessor, a
// value an i32 field cannot hold) converts that object to an ordinary one first.
// js-literal-structs.profile.json: make-fixture-profile.mjs over the helper (fields id,value,tag;
// representations id:s,value:s,tag:h).
// @options: {"experimentalJsConstructorStructs":true,"experimentalJsLiteralStructs":true,"experimentalJsSpecialize":"profile","experimentalJsSpecializeProfile":"fixtures/js-literal-structs.profile.json"}
// @native-only: literal structs and profile guards are native-dyn compile options
// @hits(native,native-any): ^\$ctor\.demote$
// @hits(native,native-any): ^\$ctor\.hit\.(read|i32)$
import { make, checks } from "./js-literal-structs-helper.js";
const list: any[] = [];
for (let i = 0; i < 40; i++) list.push(make(i));
console.log(checks(list));
