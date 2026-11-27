// === / !== over every dyn kind: NaN, signed zeros, equal strings in
// different boxes, page values, null vs undefined, booleans, mixed kinds.
export function pairsEq(page, page2, pfn, sym, nanBits) {
  const obj = { a: 1 }, arr = [1], fn = () => 1;
  const ab = ["a", "b"].join(""), ab2 = String.fromCharCode(97, 98), ab3 = JSON.parse('"ab"');
  const pairs = [[NaN, NaN], [0, -0], [-0, 0], ["ab", "a" + "b"], [ab, ab2], [ab2, ab3], [null, undefined], [undefined, undefined], [null, null],
    [true, true], [true, 1], [false, 0], ["1", 1], [page, page], [page, page2], [pfn, pfn], [sym, sym], [obj, obj], [obj, { a: 1 }],
    [arr, arr], [arr, [1]], [fn, fn], [nanBits, nanBits], [nanBits, NaN], [Infinity, Infinity], [-Infinity, Infinity], ["", 0], [null, 0]];
  let out = "";
  for (let i = 0; i < pairs.length; i++) { const a = pairs[i][0], b = pairs[i][1]; out += (a === b ? "1" : "0") + (a !== b ? "1" : "0") + " "; }
  return out;
}
export function searches() {
  const xs = JSON.parse("[1, 0, 2]"); xs.push(NaN, -0, "1");
  return [xs.indexOf(NaN), xs.includes(NaN), xs.indexOf(-0), xs.indexOf(0), xs.lastIndexOf(0), xs.indexOf("1"), xs.indexOf(1)].join(",");
}
export function sw(v) { switch (v) { case 0: return "zero"; case "0": return "str0"; case null: return "null"; case undefined: return "undef"; case false: return "false"; default: return "other"; } }
