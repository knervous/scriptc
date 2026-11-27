export function run() {
  const out = ["start"];
  async function* g() { yield 1; yield 2; }
  out.push(typeof g);
  try { const it = g(); out.push(typeof it); } catch (e) { out.push("caught " + e.name); }
  return out.join(" ");
}
