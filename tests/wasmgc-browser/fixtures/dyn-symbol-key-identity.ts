// @native-any-only: symbol keys on untyped objects and class spreads are native-any dyn operations
// Symbol keys by identity: Symbol("x") and the string "Symbol(x)" are different keys; Object.keys,
// for-in and JSON skip symbols; spread copies them (class symbol fields too).
import { run } from "./dyn-symbol-key-identity-helper.js";
console.log(run());
