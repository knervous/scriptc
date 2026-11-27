export function typedIndex() {
  const out = [];
  const m = "a1".match(/\d/);
  try { out.push(m === null ? "none" : m.index); } catch (e) { out.push(e.message.includes("not supported") ? "refused" : e.message); }
  const x = /(\d)/.exec("b2");
  out.push(x === null ? "none" : x.length - 2);
  try { out.push(x === null ? "none" : x.input); } catch (e) { out.push(e.message.includes("not supported") ? "refused" : e.message); }
  const g = "a1b2".match(/\d/g);
  out.push(g === null ? "none" : String(g.index));
  return out.join(" ");
}
