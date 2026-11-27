// experimentalDomMirror: compiled expandos on mirrored nodes (keys no DOM
// interface defines) live in Wasm; DOM members stay the node's.
export function expandos(p) {
  const doc = p.doc, out = [];
  const el = doc.createElement("div"), key = "__probe$" + 7;
  el[key] = { n: 1 };
  el.plain = 2;
  el.id = "x";
  out.push(el[key].n, el.plain, key in el, "plain" in el, Object.prototype.hasOwnProperty.call(el, key), el.id, p.own(el), String(p.getOwn(el, key)), p.getOwn(el, "id"));
  p.setOwn(el, "pageSet", 3);
  out.push(el.pageSet, "pageSet" in el, p.getOwn(el, "pageSet"));
  delete el[key];
  out.push(el[key], key in el, el.plain);
  el[key] = 5;
  out.push(el[key], delete el.plain, el.plain, "plain" in el);
  const t = doc.createTextNode("t");
  t.__data = [1, 2];
  out.push(t.__data.length, p.own(t), t.nodeValue);
  // A page node (not created by compiled code) keeps every property on the node.
  const page = doc.body;
  page.__mark = 1;
  out.push(page.__mark, p.getOwn(page, "__mark"));
  delete page.__mark;
  out.push(p.getOwn(page, "__mark"));
  return out.join(" ");
}
