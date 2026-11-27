export function run() {
  const out = [];
  function* readsThis() { yield this.v; yield this.v + 1; }
  const o = { v: 10, gen: readsThis };
  out.push([...o.gen()].join("+"));
  out.push([...readsThis.call({ v: 20 })].join("+"));
  const second = { v: 30, gen: readsThis };
  const a = o.gen(), b = second.gen();
  out.push(a.next().value, b.next().value, a.next().value, b.next().value);
  return out.join(" ");
}
