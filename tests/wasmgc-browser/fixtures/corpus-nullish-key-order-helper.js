export function nullishKeys() {
  let order = "";
  const t = { toString() { order += "c"; return "key"; } };
  const N = JSON.parse("null"), U = JSON.parse("[]")[0];
  const out = [];
  const cases = [() => { N[t] = 1; }, () => { N["k" + ""] = 1; }, () => { N[5] = 1; }, () => { N[true] = 1; },
    () => U[t], () => N[t], () => U[null], () => U[5], () => { N[t] = (order += "v", 1); }];
  for (const f of cases) {
    try { f(); } catch (e) { out.push(e.name + ": " + e.message + " /" + order); }
  }
  return out.join("\n");
}
