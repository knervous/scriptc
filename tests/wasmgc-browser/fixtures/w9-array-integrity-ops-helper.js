// Array methods on sealed and frozen untyped arrays fail at JS's first failing
// write: no-op calls succeed, sealed shift/splice move elements before failing,
// a same-length splice on a sealed array succeeds and keeps it sealed.
export function run() {
  const out = [];
  const t = (label, f) => { try { const r = f(); out.push(label + ":" + (Array.isArray(r) ? r.join(",") : r)); } catch (e) { out.push(label + ":" + e.name); } };
  const e = JSON.parse('[]'); Object.freeze(e);
  t("esort", () => e.sort().length); t("erev", () => e.reverse().length); t("efill", () => e.fill(1).length); t("epush", () => e.push());
  const one = JSON.parse('[1]'); Object.freeze(one);
  t("1sort", () => one.sort()); t("1rev", () => one.reverse()); t("1fill0", () => one.fill(9, 0, 0)); t("1fill", () => one.fill(9));
  const s = JSON.parse('[1,2,3]'); Object.seal(s);
  t("ssplice", () => s.splice(1, 1, 7)); out.push(s.join(",") + " " + Object.isSealed(s));
  t("sshrink", () => s.splice(1, 1)); out.push(s.join(","));
  t("sgrow", () => s.splice(0, 0, 8)); out.push(s.join(","));
  const s2 = JSON.parse('[4,5]'); Object.seal(s2);
  t("spop", () => s2.pop()); t("sshift", () => s2.shift()); out.push(s2.join(","));
  const s3 = JSON.parse('[]'); Object.seal(s3);
  t("s0pop", () => s3.pop()); t("s0shift", () => s3.shift()); t("s0push", () => s3.push());
  return out.join(" ");
}
