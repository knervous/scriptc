// Nullish receivers in JavaScript: V8's TypeError text for reads, writes,
// `in`, and the Object.* conversions.
export function writes() {
  const out = [];
  const t = (f) => { try { f(); out.push("ok"); } catch (e) { out.push(e.name + ": " + e.message); } };
  let u, n = null;
  const k = "id";
  t(() => k in u); t(() => "x" in n); t(() => 0 in u);
  t(() => Object.prototype.hasOwnProperty.call(u, "x")); t(() => Object.getPrototypeOf(n)); t(() => Object.assign(u, {}));
  t(() => { u.x = 1; }); t(() => { n.x = 1; }); t(() => { n[k] = 1; }); t(() => { u[0] = 1; });
  return out.join("\n");
}
export function reads(sym) {
  const out = [];
  const t = (f) => { try { f(); out.push("ok"); } catch (e) { out.push(e.name + ": " + e.message); } };
  let u, n = null;
  const k = "id", k2 = 5, k3 = "it's";
  t(() => u[k]); t(() => n[k]); t(() => u[k2]); t(() => n[0]); t(() => u[k3]); t(() => u["é"]); t(() => u[sym]);
  t(() => u.length); t(() => n.toString); t(() => u.a.b);
  t(() => { u.x = 1; }); t(() => { n.x = 1; }); t(() => { n[k] = 1; });
  return out.join("\n");
}
