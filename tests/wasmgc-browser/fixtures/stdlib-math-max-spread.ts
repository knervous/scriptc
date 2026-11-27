// @options: {"interfaceClassArms": true}
// Math.max/min with a leading number and a spread of a number[] field.
class Batch { materialOf: number[] = []; }
const b = new Batch();
console.log(Math.max(0, ...b.materialOf) + 1);
b.materialOf = [3, 9, 4];
console.log(Math.max(0, ...b.materialOf) + 1, Math.min(100, ...b.materialOf), Math.max(...b.materialOf));
