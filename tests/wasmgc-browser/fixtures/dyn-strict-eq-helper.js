// === between untyped values of every kind (the native dyn strictEq front and its slow path).
export function grid(values) {
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = "";
    for (var j = 0; j < values.length; j++) row += values[i] === values[j] ? "1" : (values[i] !== values[j] ? "0" : "?");
    rows.push(row);
  }
  return rows.join(" ");
}
export function values(page, pageAgain, big, big2) {
  var o = {}, a = [], f = function () {};
  var s1 = "ab", s2 = ["a", "b"].join(""), n1 = JSON.parse("null"), n2 = [null][0];
  return [undefined, void 0, null, n1, n2, 0, -0, NaN, 0 / 0, 1, "1", s1, s2, "", true, false, !0, o, o, {}, a, a, [], f, f, page, pageAgain, big, big2];
}
