// ToPrimitive in JavaScript over values handed in from TypeScript.
export function conv(v) {
  const out = [];
  const t = (n, f) => { try { out.push(n + "=" + String(f())); } catch (e) { out.push(n + "!" + e.name + ":" + e.message); } };
  t("add", () => v + 1); t("mul", () => v * 2); t("tmpl", () => `${v}`); t("cat", () => "" + v);
  t("eq9", () => v == 9); t("eqStr", () => v == "[object Object]"); t("lt", () => v < 10);
  t("inc", () => { let x = v; x++; return x; });
  return out.join(" ");
}
export function pageEq(p) { return [p == "[object Object]", p == 1, 1 == p, p == p, p != "x"].join(","); }
