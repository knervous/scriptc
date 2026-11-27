// Constant keys whose helper-name spellings used to coincide ("é" and "_e9",
// "-" and "_2d", "a.b" and "a_2eb"): functions, objects, arrays, page values.
export function oddKeys(page) {
  const f = function () {};
  f.é = "acute"; f._e9 = "esc"; f["-"] = "dash"; f._2d = "esc2";
  const o = { é: 1, _e9: 2, "a.b": 3, a_2eb: 4 };
  page.é = "pa"; page._e9 = "pe";
  const arr = JSON.parse("[1]");
  return [f.é, f._e9, f["-"], f._2d, o.é, o._e9, o["a.b"], o.a_2eb, page.é, page._e9, arr.é, arr._e9].join(",");
}
export function readRecord(r) { return [r["-"], r._2d, r["a.b"], r.a_2eb, r.é, r._e9].join(","); }
