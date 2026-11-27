// Object patterns over a nullish untyped source: V8's destructuring TypeError.
const t = (f) => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
export function run(v) {
  const out = [];
  out.push(t(() => { const { x } = v; return "ok " + x; }));
  out.push(t(() => { let x; ({ x } = v); return "ok " + x; }));
  const f = () => v, o = { inner: v };
  out.push(t(() => { const { y } = f(); return "ok " + y; }));
  out.push(t(() => { const { z } = o.inner; return "ok " + z; }));
  out.push(t(() => { const { "s-k": s } = v; return "ok " + s; }));
  return out.join("\n");
}
