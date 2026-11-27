export function forIn() {
  function P() { this.a = 1; }
  P.prototype.m = function () { return 0; };
  const o = new P();
  let s = "";
  for (const k in o) s += k;
  const child = {};
  Object.setPrototypeOf(child, { inherited: 1 });
  child.own = 2;
  let t = "";
  for (const k in child) t += k + ",";
  return s + " " + t;
}
export function protoKeys() {
  function Q() {}
  Q.prototype.z = 1;
  const own = Object.keys(Q.prototype).join(","), q = new Q();

  let s = ""; for (const k in q) s += k;
  return own + "|" + s + "|" + Q.prototype.hasOwnProperty("constructor") + ":" + (q.constructor === Q);
}
