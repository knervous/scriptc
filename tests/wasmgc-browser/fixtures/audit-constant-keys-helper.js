// Constant-key reads in JavaScript over values handed in from TypeScript.
export function readAll(v) {
  const out = [];
  const t = (name, f) => { try { const x = f(); out.push(name + "=" + (typeof x === "object" && x !== null ? "obj" : String(x))); } catch (e) { out.push(name + "!" + e.name + ":" + e.message); } };
  t("id", () => v.id); t("n", () => v.n); t("length", () => v.length); t("0", () => v["0"]); t("1", () => v[1]);
  t("missing", () => v.missing); t("message", () => v.message); t("name", () => v.name); t("extra", () => v.extra); t("g", () => v.g);
  t("opt", () => v?.id);
  return out.join(" ");
}
export function readId(v) { return v.id; }
export function readIdOpt(v) { return v?.id; }
export function readLen(v) { return v.length; }
export function readChain(v) { return v?.inner?.id; }
export function addExpando(v) { v.extra = "x"; v.id = v.id + 1; }
export function arrayKeys() {
  const a = JSON.parse("[10, 20, 30]");
  const lit = [a.length, a["0"], a["2"], a["3"], a["01"], a["-0"], a["1e3"], a["1.0"], a["4294967295"], a["2147483648"], a["2147483647"], a[" 1"], a["+1"], a["0x1"], a.foo].join(",");
  const ks = ["0", "01", "-0", "1.0", "1e3", "2", "3", "4294967295", "2147483648", " 1", "1 ", "+1", "0x1", "length"];
  return lit + " | " + ks.map((k) => String(a[k])).join(",") + " | " + ks.map((k) => (k in a ? "1" : "0")).join("");
}
