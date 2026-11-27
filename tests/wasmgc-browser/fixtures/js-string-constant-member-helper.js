// Constant-key reads (not calls) of inherited members on an untyped string.
export function members(s) {
  const upper = s.toUpperCase, at = (o, k) => o[k];
  return `${typeof upper} ${upper === at(s, "toUpperCase")} ${typeof s.valueOf} ${upper.call(s)} ${typeof s.nope}`;
}
export function ctor(s) { try { return typeof s.constructor; } catch (e) { return `${e.name} ${e.message}`; } }
