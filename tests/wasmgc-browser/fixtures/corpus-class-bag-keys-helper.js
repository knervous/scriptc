class Base {
  constructor() { this.base = 1; }
  attach(value) { this.extra = value; }
}
class Data {
  first = 1;
  second = 2;
}
export function classBags() {
  const out = [];
  const b = new Base();
  out.push(Object.keys(b).join(","));
  b.attach(42);
  out.push(Object.keys(b).join(","), JSON.stringify(b));
  const d = new Data();
  const r = /** @type {unknown} */ (d);
  r.extra = 3;
  out.push(Object.keys(r).join(","), JSON.stringify(r), JSON.stringify(Object.getOwnPropertyDescriptor(r, "extra")));
  Object.assign(r, { first: 4, appended: 5 });
  out.push(String(d.first), JSON.stringify(r));
  Object.defineProperty(r, String("hidden"), { value: 6 });
  out.push(String(r.hidden), Object.keys(r).join(","), JSON.stringify(Object.getOwnPropertyDescriptor(r, "hidden")));
  return out.join(" | ");
}
