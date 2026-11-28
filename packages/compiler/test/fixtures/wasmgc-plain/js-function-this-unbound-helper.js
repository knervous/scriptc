// A JavaScript module's functions, none of which reads `this`: each still binds its own `this` at entry.
export function twice(x) { return x * 2; }
export const label = function (n) { return "n=" + twice(n); };
