// @options: {"hostHandles": true}
// @native-any-only: the any-typed values and the untyped helper's Object reads meet only in the native any model
// `Object` read as a value (typeof, aliases, statics read off it, `Object(v)` / `new Object()` through the alias, `x.constructor`) is the
// native host's compiled constructor: no page Object global is asked.
import { probe, statics, ctor, viaConstructor } from './s-object-ctor-value-helper.js';
console.log(probe().join());
console.log(statics().join("|"));
console.log(ctor().join());
console.log(viaConstructor().join());
