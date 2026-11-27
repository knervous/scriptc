export function keys(o) { var out = []; for (var k in o) out.push(k); return out; }
/** @returns {any} */
export function make(kind) {
  if (kind === 0) return ["a", "b", 3];
  if (kind === 1) return [1, 2, "x"];
  if (kind === 2) return [true, null];
  if (kind === 3) return [{ a: "x" }, { a: 2 }];
  if (kind === 4) return [["a"], ["b", 5]];
  if (kind === 5) return [1, , "z", undefined];
  if (kind === 6) return [0.5, -0, NaN, 1e21];
  if (kind === 7) return [false, true, false];
  return "not an array";
}
