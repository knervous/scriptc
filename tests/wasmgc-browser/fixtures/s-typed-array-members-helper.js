var out = [];
function t(label, f) { try { out.push(label + "=" + JSON.stringify(f())); } catch (e) { out.push(label + "!" + String(e && e.message).slice(0, 90)); } }
export function run(s, nums, strs, recs) {
  var m = s.match(/(l+)(o)/);
  t("m-null", () => m === null); t("m-length", () => m.length); t("m-idx", () => [m[0], m[1], m[2], m[3]]); t("m-slice", () => m.slice(0, 3)); t("m-map", () => m.map(function (x) { return x.length; }));
  t("m-join", () => m.join("|")); t("m-indexOf", () => m.indexOf("o")); t("m-includes", () => m.includes("ll")); t("m-index", () => m.index); t("m-input", () => m.input); t("m-groups", () => m.groups);
  t("m-isArray", () => Array.isArray(m)); t("m-spread", () => [...m]); t("m-forEach", () => { var r = []; m.forEach(function (x, i) { r.push(i + x); }); return r; });
  t("m-keys", () => Object.keys(m)); t("m-named", () => s.match(/(?<a>l+)/).groups.a); t("m-typeof-slice", () => typeof m.slice);
  t("n-slice", () => nums.slice(1)); t("n-map", () => nums.map(function (x) { return x * 2; })); t("n-join", () => nums.join("-")); t("n-indexOf", () => nums.indexOf(3)); t("n-includes", () => nums.includes(2)); t("n-length", () => nums.length); t("n-at", () => nums.at(-1)); t("n-reduce", () => nums.reduce(function (a, b) { return a + b; }, 0));
  t("s-slice", () => strs.slice(1)); t("s-map", () => strs.map(function (x) { return x.toUpperCase(); })); t("s-join", () => strs.join("+")); t("s-indexOf", () => strs.indexOf("b")); t("s-includes", () => strs.includes("c")); t("s-filter", () => strs.filter(function (x) { return x > "a"; })); t("s-concat", () => strs.concat(["z"]));
  t("r-slice", () => recs.slice(1).length); t("r-map", () => recs.map(function (r) { return r.k; })); t("r-find", () => recs.find(function (r) { return r.k === 2; })); t("r-length", () => recs.length); t("r-filter", () => recs.filter(function (r) { return r.k > 1; }).length);
  return out.join("\n");
}
