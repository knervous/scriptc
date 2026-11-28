// Loops over a union of typed arrays read and write each arm's own elements: the per-arm loop copies
// (ir/union-arm-loops.ts) must keep JS's evaluation order and each arm's element conversion.
type U = Uint8Array | Uint16Array | Int32Array;

function sum(a: U): number {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += a[i]!;
  return t;
}

function fill(a: U, v: number): void {
  for (let i = 0; i < a.length; i++) a[i] = v - i;
}

function pick(wide: boolean): U {
  return wide ? new Int32Array(5) : new Uint8Array(1);
}

let xs: U = new Uint8Array(6);
fill(xs, 300);
console.log(sum(xs), xs.length, xs[2]);
xs = new Uint16Array(4);
fill(xs, 70000);
console.log(sum(xs));
const ys = pick(process.argv.length > 0);
fill(ys, -3);
console.log(sum(ys), pick(false)[0], ys[1]);

// The key is read before the value, and a value that rebinds the key's local does not move the store.
let k = 0;
const zs: U = new Int32Array(3);
zs[k++] = 9;
zs[k] = (k = 2, 7);
console.log(zs[0], zs[1], zs[2], k);
