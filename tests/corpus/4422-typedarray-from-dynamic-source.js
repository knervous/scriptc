// TypedArray.from over sources whose reading is decided at run time (every
// value in a JS module is dynamic): array-likes walk their indices between
// mapper calls with the length read once, iterables drain before the first
// mapper call, the mapper's thisArg, and the errors for a non-callable mapper
// and a nullish source (Array.from's non-callable mapper message too).
const log = [];
const show = (label, view) => console.log(label, view.length, view.join(","));

// An array-like with logging getters: length once, then index, mapper, index, mapper.
const watched = {
  get length() { log.push("length"); return 3.7; },
  get 0() { log.push("get 0"); return 1; },
  get 1() { log.push("get 1"); return "2"; },
  get 2() { log.push("get 2"); return undefined; },
};
show("getters", Float64Array.from(watched, (value, index) => {
  log.push(`map ${index}`);
  return value === undefined ? -1 : Number(value) * 2;
}));
console.log(log.splice(0).join(", "));
show("getters no mapper", Int8Array.from(watched));
console.log(log.splice(0).join(", "));

// An iterable object of its own.
const custom = {
  length: 10,
  [Symbol.iterator]() {
    let n = 0;
    return { next: () => (n < 3 ? { value: ++n * 7, done: false } : { value: undefined, done: true }) };
  },
};
show("custom iterable", Int16Array.from(custom, (value, index) => value + index));
show("custom iterable no mapper", Int16Array.from(custom));

// Map entries are not numbers; values are.
const map = new Map([["a", 4], ["b", 5]]);
show("map values", Uint32Array.from(map.values(), (value) => value * 3));
show("map entries", Float32Array.from(map, (entry) => entry[1] / 2));

// thisArg reaches a non-arrow mapper.
show("thisArg", Int32Array.from({ length: 3 }, function (_value, index) { return this.base + index; }, { base: 40 }));

// Mapped values convert per kind, valueOf included.
const boxed = { valueOf() { log.push("valueOf"); return 258; } };
show("valueOf", Uint8Array.from({ length: 2 }, () => boxed));
console.log(log.splice(0).join(", "));
show("strings", Float64Array.from({ length: 3 }, (_, i) => ["1.5", "", "x"][i]));
show("booleans", Int8Array.from([true, false, null], (v) => v));

// A live array-like sees the mapper's writes; an array drains first.
const live = { 0: 1, 1: 2, 2: 3, length: 3 };
show("live", Uint16Array.from(live, (value, index) => { live[index + 1] = value * 10; return value; }));
const array = [1, 2, 3];
show("array", Uint16Array.from(array, (value, index) => { array[index + 1] = value * 10; return value; }));
show("primitive", Float32Array.from(7, (v) => v));

// Errors: the mapper first, then the source.
for (const mapper of [5, "x", {}, null, true, Symbol("s"), 10n, -0]) {
  try {
    Uint8Array.from(null, mapper);
  } catch (error) {
    console.log(error instanceof TypeError, error.message);
  }
}
// Array.from's mapper check shares the message.
for (const mapper of [5, "x", null]) {
  try {
    Array.from([1], mapper);
  } catch (error) {
    console.log("Array.from", error instanceof TypeError, error.message);
  }
}
for (const source of [null, undefined]) {
  try {
    Float64Array.from(source, (v) => v);
  } catch (error) {
    console.log(error instanceof TypeError, error.message);
  }
}
try {
  Uint8Array.from({ length: 4 }, (_, index) => {
    if (index === 2) throw new RangeError(`stop at ${index}`);
    return index;
  });
} catch (error) {
  console.log(error.name, error.message);
}
