// eval and new Function have no lowering: their fence is a refusal, so the program's own catch must not swallow it.
export function run() {
  const out = ["start"];
  try { out.push(String(eval("1+1"))); } catch (e) { out.push("caught " + e); }
  return out.join(" ");
}
export function runFn() {
  try { return String(new Function("return 1")()); } catch (e) { return "caught " + e; }
}
