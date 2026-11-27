// An early-read var (undefined-armed storage) holding an array, used by concat and member reads once stored.
import { after, before } from "./var-hoisting-early-array-helper.js";
console.log(before, after);
