// @native-only: the engine dyn model has no runtime freeze of a compiled record
import { poke, addKey } from "./object-freeze-sloppy-js-helper.js";
type P = { x: number };
const frozen: P = Object.freeze({ x: 1 });
const loose: P = { x: 1 };
console.log(poke(frozen), frozen.x, Object.isFrozen(frozen));
console.log(poke(loose), loose.x);
console.log(addKey(frozen));
