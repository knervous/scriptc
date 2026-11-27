// experimentalDynInlineSlots with constructor structs: a struct object converted to an ordinary
// object (an expando, a delete) moves its fields into the inline slots and the overflow array.
// @options: {"experimentalDynInlineSlots":2,"experimentalJsConstructorStructs":true}
// @native-only: both options are native-dyn compile options
import { run, mass } from './js-ctor-structs-edges-helper.js';
import { basics, polymorphic } from "./js-inline-slots-helper.js";
console.log(run());
console.log(mass());
console.log(basics());
console.log(polymorphic());
