// TypedArray.from over array-like and iterable sources, with and without a
// mapper: ToLength on the length, holes read undefined, the mapper's thisArg,
// per-kind element conversion, iterables drained before mapping, and the
// propagation of a mapper's throw.
type Shown = Uint8Array | Uint8ClampedArray | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;
const show = (label: string, view: Shown): void => {
  console.log(label, view.length, view.join(","));
};

// The counted idiom (a physics pack's field indices).
const fieldCount = 4;
const firstField = 10;
show("u32 counted", Uint32Array.from({ length: fieldCount }, (_, index) => firstField + index));
show("u8 counted", Uint8Array.from({ length: 3 }, (_, index) => index * 100));
show("u8 empty", Uint8Array.from({ length: 0 }, () => 1));

// ToLength: fractional truncates, negative and NaN give zero.
show("len 2.9", Int16Array.from({ length: 2.9 }, (_, i) => i - 5));
show("len -3", Int16Array.from({ length: -3 }, (_, i) => i));
show("len NaN", Float64Array.from({ length: Number.NaN }, (_, i) => i));

// Holes read undefined; the mapper sees (undefined, index).
const seen: string[] = [];
const sparse = { 0: 7, 2: 9, length: 4 };
const fromSparse = Float32Array.from(sparse, (value: unknown, index) => {
  seen.push(`${index}:${String(value)}`);
  return typeof value === "number" ? value * 1.5 : -1;
});
console.log(seen.join(" "));
show("f32 sparse", fromSparse);
show("f64 sparse no mapper", Float64Array.from(sparse));
show("i32 sparse no mapper", Int32Array.from(sparse));

// The mapper's thisArg.
class Scaler {
  readonly factor: number;
  constructor(factor: number) {
    this.factor = factor;
  }
  scale(_value: unknown, index: number): number {
    return this.factor * (index + 1);
  }
}
const scaler = new Scaler(3);
show("thisArg", Int32Array.from({ length: 3 }, scaler.scale, scaler));

// Element conversion per kind.
const wide = { 0: 300, 1: -1, 2: 1.5, 3: 2.5, 4: 70000, 5: -129, length: 6 };
const ident = (value: number): number => value;
show("u8", Uint8Array.from(wide, ident));
show("u8c", Uint8ClampedArray.from(wide, ident));
show("i8", Int8Array.from(wide, ident));
show("u16", Uint16Array.from(wide, ident));
show("i16", Int16Array.from(wide, ident));
show("u32", Uint32Array.from(wide, ident));
show("i32", Int32Array.from(wide, ident));
show("f32", Float32Array.from(wide, (value) => value / 3));
show("f64", Float64Array.from(wide, (value) => value / 3));
show("mapped strings", Uint16Array.from({ length: 3 }, (_, i) => Number(`${i}${i}`)));

// Iterables win over array-likes: a Set, a Map's values, a generator, a string.
const set = new Set([5, 6, 7]);
show("set", Uint8Array.from(set, (value, index) => value * 10 + index));
const map = new Map<string, number>([["a", 1], ["b", 2]]);
show("map values", Int8Array.from(map.values(), (value) => -value));
const order: string[] = [];
function* produce(): Generator<number> {
  for (let i = 1; i <= 3; i++) {
    order.push(`yield ${i}`);
    yield i;
  }
}
show("generator", Float64Array.from(produce(), (value) => {
  order.push(`map ${value}`);
  return value / 4;
}));
console.log(order.join(", "));
show("string", Uint8Array.from("4821", (ch) => Number(ch)));

// An iterable is drained before the first mapper call; an array-like is read
// between mapper calls (its length once).
const growing = new Set([1, 2]);
show("set drained", Uint16Array.from(growing, (value) => {
  if (growing.size < 5) growing.add(value + 100);
  return value;
}));
const typed = Uint8Array.from([1, 2, 3]);
show("typed drained", Uint8Array.from(typed, (value, index) => {
  if (index + 1 < typed.length) typed[index + 1] = 99;
  return value;
}));
const live: { [index: number]: number; length: number } = { 0: 1, 1: 2, 2: 3, length: 3 };
show("array-like live", Uint8Array.from(live, (value, index) => {
  live[index + 1] = 100 + index;
  live.length = 1;
  return value;
}));
const holder: number[] = [1, 2, 3];
show("array drained", Int32Array.from(holder, (value, index) => {
  holder[index + 1] = -value;
  return value;
}));

// A declared ArrayLike that holds an array still iterates.
const declared: ArrayLike<number> = [5, 6];
show("ArrayLike array", Uint8Array.from(declared, (value) => value + 1));

// A throwing mapper propagates its error (the non-callable mapper and nullish
// source errors are pinned by 4422-typedarray-from-dynamic-source.js).
const tryFrom = (label: string, run: () => Shown): void => {
  try {
    show(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError, error instanceof Error ? error.message : String(error));
  }
};
tryFrom("throwing mapper", () => Uint8Array.from({ length: 3 }, (_, index) => {
  if (index === 1) throw new RangeError("stop at 1");
  return index;
}));
