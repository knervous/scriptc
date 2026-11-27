// A tuple of one element type indexed at run time: in-range reads, an
// out-of-range, fractional or NaN index (undefined, as an array read), and
// the proven-present `t[i]!` form.
type Rgb = [number, number, number];
const colour: Rgb = [10, 20, 30];
let sum = 0;
for (let c = 0; c < 3; c++) sum += colour[c]!;
console.log(sum);
const at = (t: Rgb, i: number): number | undefined => t[i];
console.log(at(colour, 1), at(colour, 3), at(colour, 0.5), at(colour, -1), at(colour, Number.NaN));
const names: [string, string] = ["left", "right"];
for (let i = 0; i < 2; i++) console.log(names[i]?.toUpperCase() ?? "none");
