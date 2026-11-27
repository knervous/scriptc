// @native-only: the engine model does not compile a typed array's .buffer held by untyped code (an invalid module, pre-existing)
// A typed array's .buffer is one object per underlying storage: every read
// and every view of that storage answers the same buffer (=== and WeakMap
// keys agree). Corpus: weak-map-native, weak-set-native.
import { bufferIdentity } from "./corpus-buffer-identity-helper.js";
console.log(bufferIdentity());
