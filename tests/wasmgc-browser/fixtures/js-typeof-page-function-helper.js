// typeof tests on untyped values, including page functions held in dyn.
export function kinds(v) {
  return `${typeof v === "function"} ${"function" === typeof v} ${typeof v !== "function"} ${typeof v}`;
}
export function callIfFunction(f, x) { return typeof f === "function" ? f(x) : "skipped"; }
