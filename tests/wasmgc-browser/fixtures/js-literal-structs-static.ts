// Literal structs without a site profile: with experimentalJsPointsTo the analysis picks the layouts
// (some property site reads only objects of that layout's literal sites) and types an i32 field
// where every value it sees is an int32. Same semantics checks as js-literal-structs.
// @options: {"experimentalJsConstructorStructs":true,"experimentalJsLiteralStructs":true,"experimentalJsPointsTo":true}
// @native-only: literal structs and the compile-time analysis are native-dyn compile options
// @hits(native,native-any): ^\$ctor\.demote$
import { make, checks } from "./js-literal-structs-helper.js";
const list: any[] = [];
for (let i = 0; i < 40; i++) list.push(make(i));
console.log(checks(list));
