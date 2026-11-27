// Constructor structs with a put prefix: the puts make the struct complete, the code after them runs
// on it unchanged. Only constructors whose remainder keeps `this` to reads, its own properties'
// writes and `return this` are structs (Point, Self, Checked, Maybe); Registered and Extended stay ordinary.
// @options: {"experimentalJsConstructorStructs":true}
// @native-only: experimentalJsConstructorStructs is a native-dyn compile option
// @hits(native,native-any): ^\$ctor\.\d+\.new$
// @hits(native,native-any): ^\$ctor\.hit\.read$
import { points, others } from "./js-ctor-structs-prefix-helper.js";
console.log(points());
console.log(others());
