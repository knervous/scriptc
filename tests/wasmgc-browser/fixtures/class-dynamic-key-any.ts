// @known-defect(native-any,native-sim): a computed-key read through `any` of a class instance whose class has no dynamic key table (only `as any` reaches it) answers undefined instead of the field: the analysis that emits %dyn.class key tables misses classes cast to any. The table-driven class metadata redesign (docs/plans) fixes it.
// @known-defect-expect: stdout: undefined undefined undefined undefined undefined undefined
// @expect: 1 2 3 undefined 9 7 true false
// Computed-key reads and writes of a class instance through `any`: fields, a getter, a missing key, `in`.
class Many {
  a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8;
  get i(): number { return 9; }
  m(): number { return this.a; }
}
const many = new Many();
const anyMany = many as any;
const keys = ["a", "b", "c", "nope", "i", "g"];
const read = keys.map((k) => String(anyMany[k]));
anyMany["h"] = 80;
console.log(read.join(" "), many.h === 80, "nope" in anyMany);
