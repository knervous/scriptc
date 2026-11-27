// `sym in v` with a symbol key on native dyn values: a symbol is no atom
// (its string form would be looked up instead), so the page answers on the
// value's facade: inherited well-known symbols of arrays, symbol-keyed
// expandos, and the TypeError on a nullish target. Corpus: js-checked-array-iterator.
import { symbolIn } from "./corpus-symbol-in-key-helper.js";
console.log(symbolIn());
