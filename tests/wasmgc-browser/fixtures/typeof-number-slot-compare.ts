// `typeof x === "<literal>"` on a number slot is a test of the undefined-NaN sentinel (an out-of-range typed-array read
// is undefined), not a string built and compared: "number", "undefined", any other literal, === and !==, and an operand
// with a side effect evaluated exactly once.
const f = new Float32Array([1.5, NaN, -0, 3]);
let reads = 0;
const at = (i: number): number => { reads++; return f[i]!; };
const out: string[] = [];
for (const i of [0, 1, 2, 3, 4, -1, 100]) {
  const v = f[i]!;
  out.push(`${i}:${typeof v === "number"}/${typeof v === "undefined"}/${typeof v !== "number"}/${typeof v === "string"}/${typeof v !== "object"}`);
}
out.push(String(typeof at(1) === "number"), String(typeof at(9) === "undefined"), String(typeof at(0) === "bigint"), String(reads));
let n = 0;
for (let i = 0; i < 8; i++) if (typeof f[i] === "number") n++;
out.push(String(n));
console.log(out.join(" "));
