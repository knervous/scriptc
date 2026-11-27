// A typed-array read at an index the array has no element at (past the end, negative, fractional) reads undefined,
// and a program that only compares, tests or computes with it sees what JS sees: equal to nothing, false in every
// comparison, NaN in arithmetic, 0 under the bitwise operators, falsy. (A lookaside array that has not grown to an
// instance yet: `flags[i] === 1` is a plain "no".)

class Flags {
  private flags = new Uint8Array(0);

  set(index: number): void {
    if (index >= this.flags.length) {
      const grown = new Uint8Array(Math.max(index + 1, this.flags.length * 2));
      grown.set(this.flags);
      this.flags = grown;
    }
    this.flags[index] = 1;
  }

  has(index: number): boolean {
    return this.flags[index] === 1;
  }
}

const flags = new Flags();
console.log("before", flags.has(0), flags.has(3));
flags.set(2);
console.log("after", flags.has(0), flags.has(2), flags.has(3), flags.has(40));

const bytes = new Uint8Array([7, 8, 9]);
const words = new Uint32Array([4000000000, 1]);
const halves = new Int16Array([-5, 5]);
const reals = new Float64Array([0.5, 1.5]);

for (const at of [1, 3, -1, 1.5, 100]) {
  const b = bytes[at];
  const w = words[at];
  const h = halves[at];
  const r = reals[at];
  console.log(
    at,
    b === 8, b !== 8, b == 8, b != 8,
    b < 100, b > -1, b <= 8, b >= 8,
    b + 1, b * 2, w + 1, h - 1, r / 2,
    b | 0, w >>> 0, h & 3, ~r, -b,
    b ? "truthy" : "falsy", !r,
    Math.max(b, 2),
  );
}

let sum = 0;
for (let i = 0; i <= bytes.length; i++) sum += bytes[i] | 0;
console.log("sum through the end", sum);

const counters = new Int32Array(2);
const old = counters[5]++;
console.log("increment past the end", Number.isNaN(old), counters.length, counters[0], counters[1]);
