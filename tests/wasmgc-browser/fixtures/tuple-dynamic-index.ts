const min: [number, number, number] = [5, 6, 7];
const vs = [3, 9, 1];
for (let k = 0; k < 3; k++) min[k] = Math.min(min[k]!, vs[k]!);
console.log(min[0], min[1], min[2]);
let sum = 0;
for (let k = 0; k < 3; k++) sum += min[k]!;
console.log(sum);
const pair: [string, string] = ["a", "b"];
for (let k = 0; k < 2; k++) pair[k] = pair[k] + "!";
console.log(pair.join(","));
// An index past the slots reads undefined (the read type is T | undefined).
function at(t: [number, number], i: number): number | undefined { return t[i]; }
console.log(at([1, 2], 0), at([1, 2], 1), at([1, 2], 2), at([1, 2], -1), at([1, 2], 0.5));
