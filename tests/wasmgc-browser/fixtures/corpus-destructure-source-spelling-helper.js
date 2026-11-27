function make(value) { return value; }
const source = { nested: { make } };
let a, b;
export function spellings() {
  const out = [];
  const cases = [() => ({ ["x"]: a } = make(null)), () => ({ x: a } = make(null)), () => ({ "x": a } = source.nested.make(undefined)),
    () => ({} = make(null)), () => ({ a, b } = make(undefined))];
  for (const f of cases) {
    try { f(); out.push("ok"); } catch (e) { out.push(e.name + ": " + e.message); }
  }
  ({ a, b } = make({ a: 1, b: 2 }));
  out.push(a + "," + b);
  return out.join("\n");
}
