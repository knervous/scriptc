// Array.prototype.splice's deleteCount on native dyn arrays: no arguments
// delete nothing; a start alone deletes to the end; an explicit count is
// ToIntegerOrInfinity clamped to [0, len - start] (a negative count is 0,
// never counted from the end). Corpus: 3044-array-slice-splice-positions.
import { splices } from "./corpus-splice-delete-count-helper.js";
console.log(splices());
