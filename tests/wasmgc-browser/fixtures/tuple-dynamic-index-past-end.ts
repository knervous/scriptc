// @profile: a tuple is fixed-shape: a non-literal index write past its slots throws a catchable RangeError (JS would grow the array)
// @expect: 1,9
// @expect: threw true
const pair: [number, number] = [1, 2];
let k = 1;
pair[k] = 9;
console.log(pair.join(","));
let threw = false;
try {
  k = 2;
  pair[k] = 3;
} catch (e) {
  threw = e instanceof RangeError;
}
console.log("threw", threw);
export {};
