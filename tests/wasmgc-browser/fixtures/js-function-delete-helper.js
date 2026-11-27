// delete on a compiled function removes its own property; its prototype is
// non-configurable (JS's TypeError).
function f(a) { return a; }
export function run() {
  f.x = 1;
  delete f.x;
  let e = "none"; try { const k = "prototype"; delete f[k]; } catch (err) { e = err.name; }
  return `${"x" in f} ${f.hasOwnProperty("x")} ${e} ${typeof f.prototype}`;
}
