// `%` on int32 operands takes i32.rem_s at the site; every other case keeps exact fmod. The result has the dividend's
// sign (-0 included), a zero divisor gives NaN, and values past int32 or non-integral stay exact.
const values = [0, -0, 1, -1, 4, -4, 5, -5, 7, 2147483647, -2147483648, 2147483648, 4294967296, 1.5, -2.25, 1e300, NaN, Infinity, -Infinity];
const show = (v: number): string => (Object.is(v, -0) ? "-0" : String(v));
const rows: string[] = [];
for (const x of values) {
  const cells: string[] = [];
  for (const y of [3, -3, 2, -1, 0, -0, 0.5, 2147483647, Infinity]) cells.push(show(x % y));
  rows.push(`${show(x)}: ${cells.join(" ")}`);
}
console.log(rows.join("\n"));
// The cloud-noise wrap and array reads at computed, constant and out-of-range indices.
const cells = 8, out: number[] = [];
for (let i = -10; i <= 10; i += 3) out.push(((i % cells) + cells) % cells);
const data = [10, 20, 30, 40];
const at = (k: number): number | undefined => data[k];
console.log(out.join(","), data[0], data[3], at(1 + 1), at(-0), at(1.5), at(-1), at(4), at(2 ** 31));
