// Objects used as dictionaries (past 64 properties, or after a delete) are
// searched through a hash index: every observable answer (get, set, in,
// hasOwnProperty, key order, deletes and re-adds, attributes, prototype
// lookups) stays as before.
// @hits(native,native-any): shape\.index$
import { run } from "./js-dictionary-index-helper.js";
run();
