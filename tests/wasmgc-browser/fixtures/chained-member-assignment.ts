// Member and element assignments in value position (chains): the receiver,
// the key and the RHS evaluate once in JS order, the write goes through the
// target's own lowering (typed-array union arms, array length, record keys),
// and the expression's value is the RHS value.
type Mat4Storage = Float32Array | Float64Array;
let keys = 0;
const key = (k: number): number => { keys++; return k; };
function identity(local: Mat4Storage): void {
  local.fill(0);
  local[0] = local[5] = local[10] = local[15] = 1;
}
const m: Mat4Storage = Math.random() > 2 ? new Float64Array(16) : new Float32Array(16);
identity(m);
const arr = [0, 0, 0];
const v = (arr[key(0)] = arr[key(2)] = 7);
const lists = { a: [1, 2], b: [3] };
lists.a.length = lists.b.length = 0;
const names: Record<string, number> = {};
names["x"] = names["y"] = 3.5;
console.log(m[0], m[5], m[1], arr.join(), v, keys, lists.a.length, lists.b.length, names["x"], names["y"]);
