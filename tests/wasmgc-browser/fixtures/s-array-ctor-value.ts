// @options: {"hostHandles": true}
// @native-any-only: the any-typed values and the untyped helper's Array reads meet only in the native any model
// `Array` read as a value (typeof, aliases, statics, `new Array(n)` / `Array(n)` through the alias, `x.constructor`) is the native
// host's compiled constructor: no page Array global is asked.
import { probe, statics, ctor, viaConstructor, bad } from './s-array-ctor-value-helper.js';
console.log(probe().join());
console.log(statics().join("|"));
console.log(ctor().join());
console.log(viaConstructor().join());
console.log(bad().join());
