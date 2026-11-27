export function coerce(t0) {
  const out = [];
  out.push(t0.n * 2, t0.m * 2, t0.n - 1, t0.n | 0, ~t0.n, t0.n / 7, t0.n % 4);
  out.push(t0.n + 1, 1 + t0.n, t0.m + "", "" + t0.r, t0.r + 1, t0.e + t0.e);
  out.push(`${t0.n}|${t0.m}|${t0.r}|${t0.e}`);
  out.push(String(t0.n), String(t0.m), String(t0.r), String(t0.e));
  out.push(t0.n == 7, t0.m == "1,2", t0.e == 0, t0.e == "", t0.r == "[object Object]", t0.n == "8", t0.n != 7);
  out.push(t0.n < 8, t0.n > 8, t0.m < "1,3", t0.n <= 7, t0.n >= "7");
  out.push(Object.prototype.toString.call(t0.n), Object.prototype.toString.call(t0.r));
  out.push(`${t0}`, t0 + "");
  return out.join(" ");
}
export function pageValues(page, typed, err) {
  const out = [];
  const arr = page.auditMakeArray(), obj = page.auditMake(), big = page.auditBigInt();
  out.push(arr + 1, arr == "1,2", obj == "[object Object]", arr * 2, obj + "", arr < 3, arr == typed.m);
  try { out.push(big * 2); } catch (e) { out.push(e.name); }
  try { out.push(big + 1); } catch (e) { out.push(e.name); }
  try { out.push(big < 2); } catch (e) { out.push(e.name); }
  const two = typed.n.slice(), ten = typed.n.slice(); two[0] = 2; ten[0] = 10;
  out.push(two < ten, ten < two, typed.n == 7, typed.e == "", typed.m == "1,2", typed.m > "1");
  out.push(String(err), err + "", `${err}`, err == "Error: boom");
  return out.join(" ");
}
