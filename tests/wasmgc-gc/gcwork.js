// Generic object-heavy workloads (untyped JS, compiled under native dyn): short-lived records,
// retained records (promotion), map-like objects with computed keys, element-like trees with closures.
const NAMES = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
let ring = [], ringAt = 0, seed = 1;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; }
function makeRecord(i) {
  return { id: i, name: NAMES[i & 7], value: (i * 7) & 127, active: (i & 1) === 0, tags: [i & 3, i & 5] };
}
function records(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(makeRecord(i));
  let s = 0;
  for (let i = 0; i < out.length; i++) { const r = out[i]; if (r.active) s += r.value + r.tags[1]; }
  return s;
}
function retain(n, keep) {
  const batch = [];
  for (let i = 0; i < n; i++) batch.push(makeRecord(i + ringAt));
  ring[ringAt % keep] = batch; ringAt++;
  let s = 0;
  for (let j = 0; j < ring.length; j++) { const b = ring[j]; if (b) s += b[(ringAt * 13) & 511].value; }
  return s;
}
function dict(n) {
  const counts = {};
  for (let i = 0; i < n; i++) { const k = "k" + (rnd() & 255); counts[k] = (counts[k] || 0) + 1; }
  let s = 0;
  for (const k in counts) s += counts[k];
  return s + Object.keys(counts).length;
}
function element(type, props, key) { return { $$typeof: 1, type, key, props }; }
function tree(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const onClick = () => i + 1;
    const label = element("span", { className: "label", children: NAMES[i & 7] }, null);
    const badge = element("b", { className: "badge", "data-theme": (i & 1) ? "dark" : "light", children: i }, null);
    rows.push(element("div", { className: "row", onClick, children: [label, badge] }, "r" + i));
  }
  let s = 0;
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; s += r.props.onClick() + r.props.children[1].props.children; }
  return s;
}
export const OPS = ["records", "retain", "dict", "tree"];
export function runOp(op, count) {
  if (op === 0) return records(count);
  if (op === 1) return retain(count, 20);
  if (op === 2) return dict(count * 4);
  return tree(count);
}
