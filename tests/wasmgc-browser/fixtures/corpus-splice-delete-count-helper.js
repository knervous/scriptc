export function splices() {
  const out = [];
  const s = (x) => JSON.stringify(x);
  const a = JSON.parse("[10,20,30,40,50,60]");
  out.push(s(a.splice()), s(a));
  out.push(s(a.splice(1, -1)), s(a.splice(-3, -Infinity)), s(a.splice(2, NaN)), s(a));
  out.push(s(a.splice(1, 1.9)), s(a.splice(0, "1")), s(a));
  out.push(s(a.splice("1")), s(a));
  const b = JSON.parse("[1,2,3,4]");
  out.push(s(b.splice()), s(b.splice(2)), s(b.splice(-1, 1e10)), s(b));
  return out.join(" ");
}
