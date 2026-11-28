// The fixed-width integer contracts beside Int32: each write must be in its
// type's range (SC7002), a slot whose writes scriptc cannot see is refused
// (SC7003). contract-integer-positions.ts covers the positions that are
// not checked.
import type { Int8, Int64, Uint8, Uint16, Uint32, Uint64 } from "@scriptc/types";

class Pixel {
  r: Uint8 = 0;
  set(v: number): void {
    this.r = v % 256;
  }
}

function signed(x: Uint32): Int8 {
  return x & 0xff;
}

let h: Uint64 = 1n;
h = h * 3n;
const big: Int64 = 9223372036854775808n;

class Box<T> {
  size: Uint16 = 0;
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}

const p = new Pixel();
p.set(300);
console.log(p.r, signed(7), h, big, new Box("a").size);
