// One-code-unit reads of untyped strings: ASCII results share boxes, others are fresh.
function mk(x) { return x; }
export function chars() {
  var s = mk("onClick"), u = mk("é€😀x"), out = [];
  out.push(s[0], s[1], s[6], String(s[7]), s[0] === "o", s[1] === "n", s[0] === s[0], s[0] + s[1]);
  for (var i = 0; i < u.length; i++) out.push(u[i].charCodeAt(0), u[i] === u[i], u[i].length);
  var k = mk(0), seen = {};
  for (var j = 0; j < s.length; j++) { var c = s[j + k]; seen[c] = (seen[c] || 0) + 1; }
  out.push(Object.keys(seen).join(""), JSON.stringify(seen));
  var key = mk("onMouseEnter");
  out.push(2 < key.length && ("o" === key[0] || "O" === key[0]) && ("n" === key[1] || "N" === key[1]));
  var arr = []; for (var n = 0; n < 3; n++) arr.push(s[n]); out.push(arr.join("|"), arr[0] === mk("o"), typeof arr[1]);
  var idx = mk(-1); out.push(String(s[idx]), String(s[mk(1.5)]), s[mk("2")]);
  return out.join(",");
}
