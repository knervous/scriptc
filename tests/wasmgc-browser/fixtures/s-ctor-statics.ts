// @options: {"hostHandles": true}
// @native-any-only: the aliased constructors and their statics meet the page only in the native any model
// `Number` / `String` read as values carry their statics (Number.isInteger/..., constants, String.fromCharCode/fromCodePoint/raw), compiled.
import { run } from './s-ctor-statics-helper.js';
console.log(run(5 as any, "x" as any));
