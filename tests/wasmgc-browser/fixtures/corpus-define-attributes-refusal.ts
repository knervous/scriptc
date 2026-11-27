// @native-only: the engine model answers Object.defineProperty in the page itself
// @native-refuses: a non-writable, non-enumerable or non-configurable property cannot be defined on a native dyn array (its elements carry no attribute bits), so the definition is refused rather than made writable silently
// @expect-native: refused  2
import { defineOnArray } from "./corpus-define-attributes-refusal-helper.js";
console.log(defineOnArray());
