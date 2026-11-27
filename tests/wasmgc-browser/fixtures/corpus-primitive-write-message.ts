// A strict-mode write to a primitive is V8's TypeError naming the key, the
// type and the value. Corpus: 2601-dyn-keyed-write-ops.
import { writes } from "./corpus-primitive-write-message-helper.js";
console.log(writes());
