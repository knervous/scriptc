export function run() {
  var g = globalThis, out = [];
  var PE = g.Error, PT = g.TypeError, PR = g.RangeError;
  out.push(PE === Error, PT === TypeError, PR === RangeError, TypeError === PT);
  var c = new TypeError("c"), p = new PT("p");
  out.push(Object.getPrototypeOf(c) === PT.prototype, PT.prototype.isPrototypeOf(c), PR.prototype.isPrototypeOf(c), PE.prototype.isPrototypeOf(c), TypeError.prototype === PT.prototype, Object.getPrototypeOf(PT.prototype) === PE.prototype);
  out.push(c instanceof PT, p instanceof TypeError, p instanceof Error, c instanceof PE, c.constructor === PT, p.constructor === TypeError);
  out.push(TypeError.prototype === PT.prototype);
  try { g.nothing.x; } catch (e) { out.push(e instanceof TypeError, e instanceof PT, e.constructor === TypeError); }
  return out.join("|");
}
