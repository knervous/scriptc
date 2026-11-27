// @native-only: Object.freeze of a compiled array sets its frozen bit in the native model; the engine lane has no frozen typed arrays
// An in-bounds element write takes an inline fast path only while no array is frozen: a write onto a frozen array still
// throws in strict code, and other arrays keep writing after one was frozen.
export {};
const open: number[] = [1, 2, 3];
open[1] = 20;
const frozen = Object.freeze([1, 2, 3]) as number[];
try { frozen[0] = 9; console.log("no throw", frozen[0]); } catch (e) { console.log("threw", e instanceof TypeError, frozen[0]); }
open[2] = 30;
for (let i = 0; i < 3; i++) open[i] += 1;
console.log(open.join(","));
