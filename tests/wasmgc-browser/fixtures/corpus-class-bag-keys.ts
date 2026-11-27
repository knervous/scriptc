// @native-only: engine dyn class facades refuse new properties on compiled instances
// A JavaScript class whose instances track their own properties (fields
// created, expandos added through untyped references) keeps presence and
// order in its property bag: Object.keys, JSON.stringify, descriptors,
// Object.assign and Object.defineProperty all see it. Corpus:
// js-class-subclass-properties, native-class-properties, 112-class-descriptor-key.
import { classBags } from "./corpus-class-bag-keys-helper.js";
console.log(classBags());
