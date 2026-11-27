// A JavaScript object whose getters read `this`: checking it as a record runs them.
export function makeEye(x) {
  return { _x: x, get x() { return this._x; }, get y() { return this._x * 2; } };
}
