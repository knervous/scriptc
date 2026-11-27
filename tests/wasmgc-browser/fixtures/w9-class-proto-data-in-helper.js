// `k in instance` from untyped code sees data assigned on the class prototype
// (and inherited from a base prototype), not only own fields and methods.
class Vector {
  static { Vector.prototype.isVector = true; }
  constructor(x = 0) { this.x = x; }
  norm() { return Math.abs(this.x); }
}
class Colored extends Vector {}
class Late { constructor() { this.y = 1; } }
/** @param {unknown} value */
function isVec(value) { return "isVector" in value; }
/** @param {unknown} value */
function tagged(value) { return "tag" in value; }
export function run() {
  const v = new Vector(3), c = new Colored(-2), l = new Late();
  const before = [isVec(v), isVec(c), tagged(l), isVec(l), tagged(v)].join(",");
  Late.prototype.tag = undefined;
  return before + " " + [tagged(l), isVec(l), tagged(new Late())].join(",");
}
