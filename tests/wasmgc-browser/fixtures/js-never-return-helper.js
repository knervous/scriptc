// JS inference types an empty literal's elements as never, so these
// functions infer a never return although each returns a real value.
function first(v) { const o = { data: [] }; o.data[0] = v; return o.data[0]; }
const arrow = (v) => { const o = { list: [] }; o.list.push(v); return o.list[0]; };
const concise = (o) => o.items[0];
const fail = () => { throw new Error("boom"); };
export function run() {
  let thrown = "";
  try { fail(); } catch (e) { thrown = e.message; }
  return [first(5), first("s"), typeof first({}), arrow(7), String(arrow(null)), concise({ items: ["c"] }), thrown].join(" ");
}
