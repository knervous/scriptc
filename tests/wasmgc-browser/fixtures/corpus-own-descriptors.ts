// Object.getOwnPropertyDescriptor beyond compiled objects: strings,
// arrays, numbers and class instances answer through their page form; a
// compiled function's expandos and their attributes stay native.
// Object.defineProperty keeps attributes on a function's own properties.
// Corpus: primitive-and-function-descriptors, native-class-properties.
import { descriptors } from "./corpus-own-descriptors-helper.js";
console.log(descriptors());
