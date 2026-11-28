// Contract types checked on every backend: shapes the contract checker proves
// in this tree's lowering. An Immutable class instance and object literal, an
// Int32[] filled through the array helper, a module-level Int32 loop counter,
// and the fixed-width integer types beside Int32.
import type { Acyclic, Immutable, Int8, Int32, Int64, NoThrow, Uint8, Uint16, Uint32, Uint64 } from "@scriptc/types";

class Limits {
  readonly low: number;
  readonly high: number;
  constructor(low: number, high: number) {
    this.low = low;
    this.high = high;
  }
  span(): number {
    return this.high - this.low;
  }
}

const LIMITS: Immutable<Limits> = new Limits(-3, 12);
const NAMES: Immutable<{ first: string; last: string }> = { first: "ada", last: "lovelace" };

const counts: Int32[] = [5, 6, 7, 8];
counts.fill(0, 1, 3);
counts.push(9);

let ticks: Int32 = 0;
for (; ticks < 10; ticks++) {}

class Cell implements Acyclic {
  readonly value: Uint8;
  readonly next: Cell | undefined;
  constructor(value: Uint8, next: Cell | undefined) {
    this.value = value;
    this.next = next;
  }
}

function clampByte(x: number): NoThrow<Uint8> {
  return x < 0 ? 0 : x > 255 ? 255 : x & 0xff;
}

function signedByte(x: number): Int8 {
  return (x << 24) >> 24;
}

function halfword(x: Uint32): Uint16 {
  return x >>> 16;
}

function hash(text: string): Uint32 {
  let h: Uint32 = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function wide(a: Int64, b: Int64): Int64 {
  return BigInt.asIntN(64, a * b);
}

function bits(a: Uint64): Uint64 {
  return a ^ 0xffffffffffffffffn;
}

let list: Cell | undefined = undefined;
for (let i = 0; i < 300; i++) list = new Cell(clampByte(i), list);
let total = 0;
for (let c = list; c !== undefined; c = c.next) total += c.value;

console.log(LIMITS.span(), NAMES.first, NAMES.last);
console.log(counts.join(","), ticks, total);
console.log(signedByte(200), signedByte(-129), halfword(0xdeadbeef), hash("contracts"));
console.log(wide(3037000500n, 3037000500n), bits(5n), clampByte(-4), clampByte(1000));
