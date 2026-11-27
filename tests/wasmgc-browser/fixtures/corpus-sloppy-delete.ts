// @native-only: the engine model words the strict-mode delete TypeError differently (a separate engine-model gap)
// Sloppy-mode delete of a non-configurable property answers false without
// throwing; strict mode throws (an array's length too). Corpus:
// 3122-dynamic-delete-descriptors.
import { sloppyDelete } from "./corpus-sloppy-delete-helper.cjs";
import { strictDelete } from "./corpus-sloppy-delete-strict-helper.js";
console.log(sloppyDelete());
console.log(strictDelete());
