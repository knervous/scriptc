// A dense bitset over Int32Array words, written with the int intrinsic library: a sieve of Eratosthenes to 4 million, population counts, iteration over set
// bits, and intersections of two sets, the inner loops of a roaring-style container. Original code, Apache-2.0.

// helpers:begin: popcnt and ctz from the int intrinsic library (i32.popcnt and i32.ctz compiled).
import { popcnt, ctz } from "../../../packages/intrinsics/int.ts";
// helpers:end

export class Bitset {
  readonly words: Int32Array;
  readonly size: number;
  constructor(size: number) { this.size = size; this.words = new Int32Array((size + 31) >>> 5); }
  set(i: number): void { this.words[i >>> 5] = this.words[i >>> 5]! | (1 << (i & 31)); }
  clear(i: number): void { this.words[i >>> 5] = this.words[i >>> 5]! & ~(1 << (i & 31)); }
  has(i: number): boolean { return (this.words[i >>> 5]! & (1 << (i & 31))) !== 0; }
  count(): number { let n = 0; for (let w = 0; w < this.words.length; w++) n += popcnt(this.words[w]!); return n; }
  intersectCount(o: Bitset): number { let n = 0; for (let w = 0; w < this.words.length; w++) n += popcnt(this.words[w]! & o.words[w]!); return n; }
  /** The sum of the set bits' indexes (visits each set bit once). */
  sumOfMembers(): number {
    let s = 0;
    for (let w = 0; w < this.words.length; w++) {
      let x = this.words[w]!;
      while (x !== 0) { s += (w << 5) + ctz(x); x &= x - 1; }
    }
    return s;
  }
}

const N = 4_000_000;
const t0 = performance.now();
const primes = new Bitset(N);
for (let i = 2; i < N; i++) primes.set(i);
for (let p = 2; p * p < N; p++) if (primes.has(p)) for (let q = p * p; q < N; q += p) primes.clear(q);
const t1 = performance.now();
const odd = new Bitset(N);
for (let i = 1; i < N; i += 2) odd.set(i);
let count = 0, both = 0, sum = 0;
for (let r = 0; r < 20; r++) { count = primes.count(); both = odd.intersectCount(primes); sum = primes.sumOfMembers(); }
const t2 = performance.now();
console.log("primes below", N, count, "odd primes", both, "sum", sum);
console.log(`time.sieve ${(t1 - t0).toFixed(1)}`);
console.log(`time.scan ${(t2 - t1).toFixed(1)}`);
console.log(`time ${(t2 - t0).toFixed(1)}`);
