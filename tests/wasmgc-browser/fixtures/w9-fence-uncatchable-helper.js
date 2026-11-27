// A fence (code this backend cannot compile) caught by the program's own
// catch looked like a JS TypeError: `typeof e`, `e.name` gave plausible but
// wrong output. Once a fence fires, catches rethrow it.
export function run() {
  const out = ["start"];
  try { class Local { m() { return 1; } } out.push(typeof Local); } catch (e) { out.push("caught " + e.name); }
  return out.join(" ");
}
