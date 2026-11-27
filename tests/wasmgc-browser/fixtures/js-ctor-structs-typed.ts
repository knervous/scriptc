// Constructor structs (experimentalJsConstructorStructs): number-only properties as i32 fields. Every
// value JS can store reads back exactly (int32 edges, -0, NaN, fractions, non-numbers), compound
// updates keep JS order and conversions (a RHS converting the object midway), and the page sees numbers.
// @options: {"experimentalJsConstructorStructs":true}
// @native-only: experimentalJsConstructorStructs is a native-dyn compile option
// @hits(native,native-any): ^\$ctor\.demote$
import { edges, compound, views, node } from './js-ctor-structs-typed-helper.js';
const h: any = globalThis;
console.log(edges());
console.log(compound());
console.log(views());
const n: any = node(13);
console.log(h.auditKeys(n), JSON.stringify(n));
