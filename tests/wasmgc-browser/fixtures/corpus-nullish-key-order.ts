// A nullish base throws before ToPropertyKey: an object key is never
// converted (no toString call) and V8's message then names no key; a
// primitive key is named. The right-hand side of an assignment runs first.
// Corpus: indexed-assignment-values, native-class-property-order.
import { nullishKeys } from "./corpus-nullish-key-order-helper.js";
console.log(nullishKeys());
