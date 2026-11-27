// @native-only: the engine model's for-in recheck over primitives is a separate engine-model gap
// for-in over primitives: a string enumerates its UTF-16 indices, numbers
// and booleans nothing; the per-key presence recheck must not use `in`,
// which throws on a primitive. Corpus: renderer-export-dictionaries.
import { forInKeys } from "./corpus-forin-primitives-helper.js";
console.log(forInKeys("a😀b"), forInKeys(4), forInKeys(true), forInKeys(null), forInKeys(["x", "y"]), forInKeys(undefined));
