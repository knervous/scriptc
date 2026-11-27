// V8 names the source expression in a destructuring assignment's nullish
// TypeError ("... of 'make(...)' as it is null."), with the first property
// when it is a plain or literal key and the bare form for a computed one.
// Corpus: destructure-call-assignment.
import { spellings } from "./corpus-destructure-source-spelling-helper.js";
console.log(spellings());
