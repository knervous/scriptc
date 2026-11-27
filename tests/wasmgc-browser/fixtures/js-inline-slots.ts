// experimentalDynInlineSlots: native objects keep their first N property slots in the object
// itself; slots past N live in the overflow array. Layout only: every result matches Node.
// @options: {"experimentalDynInlineSlots":3}
// @native-only: experimentalDynInlineSlots is a native-dyn compile option
// @hits(native,native-any): ^\$obj\.slot\.(get|set)$
import { basics, reflection, polymorphic, sized } from "./js-inline-slots-helper.js";
console.log(basics());
console.log(reflection());
console.log(polymorphic());
console.log(sized());
