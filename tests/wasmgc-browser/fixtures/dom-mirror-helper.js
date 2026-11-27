// experimentalDomMirror: nodes this compiled code creates are mirrored in
// Wasm; every answer must be the DOM's, whatever page code does to them.
export function structure(p) {
  const doc = p.doc, out = [];
  const root = doc.createElement("div"), a = doc.createElement("span"), b = doc.createElement("b"), t = doc.createTextNode("x");
  out.push(root.nodeType, t.nodeType, doc.createComment("c").nodeType, root.ownerDocument === doc, root.parentNode, root.firstChild, a.nextSibling, t.previousSibling);
  root.appendChild(a); a.appendChild(t); root.appendChild(b);
  out.push(root.firstChild === a, root.lastChild === b, a.nextSibling === b, b.previousSibling === a, a.parentNode === root, t.parentNode === a, a.firstChild === t);
  out.push(b.firstChild, a.previousSibling, b.nextSibling, t.nextSibling);
  const c = doc.createElement("i");
  out.push(root.insertBefore(c, b) === c);
  out.push(p.names(root), a.nextSibling === c, c.nextSibling === b, b.previousSibling === c, c.previousSibling === a);
  root.insertBefore(doc.createElement("u"), null);
  root.insertBefore(doc.createElement("em"), root.firstChild);
  out.push(p.names(root), root.firstChild.nodeName, root.lastChild.nodeName, root.firstChild.nextSibling === a);
  // Identity: a node read back through the page is the one compiled code holds.
  out.push(p.getOwn(root, "firstChild") === root.firstChild, doc.body.appendChild(root) === root, root.parentNode === doc.body, doc.body.lastChild === root);
  const m = new Map([[a, 1]]), s = new Set([root.firstChild]);
  out.push(m.get(root.firstChild.nextSibling), s.has(root.firstChild), typeof a, String(t), a instanceof p.win.HTMLElement, t === a, Object.is(a, a));
  root.remove();
  out.push(root.parentNode, root.isConnected);
  return out.join(" ");
}
export function pageMutations(p) {
  const doc = p.doc, out = [];
  const list = doc.createElement("ul"), li = doc.createElement("li");
  list.appendChild(li);
  out.push(list.firstChild === li);
  // Page code inserts before the item compiled code knows as the first.
  const front = p.prepend(list, "li");
  out.push(list.firstChild === front, li.previousSibling === front, list.firstChild === li, front.nextSibling === li);
  p.detach(li);
  out.push(li.parentNode, list.lastChild === front, front.nextSibling);
  // Adoption into another document.
  const other = p.adopt(li);
  out.push(li.ownerDocument === other, li.ownerDocument === doc, li.parentNode === other.body);
  const x = doc.createElement("p"), y = doc.createElement("q");
  x.appendChild(y);
  const w = p.wrap(y);
  out.push(y.parentNode === w, x.firstChild === w, w.parentNode === x, y.nextSibling, w.firstChild === y);
  // A page callback compiled code runs in the middle of its work.
  const box = doc.createElement("div");
  box.textContent = "";
  const cb = p.mutateLater(box);
  out.push(box.firstChild);
  cb();
  out.push(box.firstChild && box.firstChild.data, box.firstChild === box.lastChild);
  // A page event (page code entering compiled code) between compiled reads.
  let clicks = 0;
  const btn = doc.createElement("button");
  btn.onclick = () => { clicks++; btn.appendChild(doc.createTextNode("c" + clicks)); };
  out.push(btn.firstChild);
  p.click(btn);
  out.push(btn.firstChild && btn.firstChild.data);
  p.click(btn);
  out.push(clicks, p.names(btn), btn.firstChild.data, btn.lastChild.data, btn.firstChild.nextSibling === btn.lastChild);
  return out.join(" ");
}
export function failures(p) {
  const doc = p.doc, out = [];
  const parent = doc.createElement("div"), child = doc.createElement("span");
  parent.appendChild(child);
  try { child.appendChild(parent); } catch (e) { out.push(p.errName(e)); }
  out.push(parent.firstChild === child, child.firstChild, parent.parentNode, child.parentNode === parent);
  try { parent.appendChild(parent); } catch (e) { out.push(p.errName(e)); }
  try { parent.setAttribute("bad name", 1); } catch (e) { out.push(p.errName(e)); }
  try { parent.insertBefore(doc.createElement("a"), doc.createElement("b")); } catch (e) { out.push(p.errName(e)); }
  out.push(p.names(parent), child.nextSibling, parent.lastChild === child);
  const text = doc.createTextNode("t");
  try { text.appendChild(doc.createElement("a")); } catch (e) { out.push(p.errName(e)); }
  out.push(text.firstChild, text.parentNode);
  // The node creation call itself failing.
  try { doc.createElement("1bad"); } catch (e) { out.push(p.errName(e)); }
  try { doc.createElement("a b"); } catch (e) { out.push(p.errName(e)); }
  // Work after a failure keeps going on exact facts.
  const after = doc.createElement("em");
  parent.appendChild(after);
  out.push(p.names(parent), child.nextSibling === after, after.previousSibling === child);
  return out.join(" ");
}
export function overrides(p) {
  const doc = p.doc, out = [];
  const host = doc.createElement("div");
  p.overrideAppend(host);
  const k = doc.createElement("k");
  out.push(host.appendChild(k) === k, host.firstChild === k, k.parentNode === host, p.log());
  const restore = p.overrideCreate();
  const made = doc.createElement("m");
  out.push(made.nodeName, made.parentNode, p.log());
  restore();
  p.defineCustom();
  const ce = doc.createElement("x-probe");
  doc.body.appendChild(ce);
  out.push(p.log(), ce.parentNode === doc.body);
  const holder = doc.createElement("div"), inner = doc.createElement("x-probe");
  holder.appendChild(inner);
  doc.body.appendChild(holder);
  out.push(p.log(), inner.parentNode === holder, holder.parentNode === doc.body);
  holder.remove(); ce.remove();
  out.push(ce.parentNode, ce.isConnected, holder.isConnected);
  const sc = doc.createElement("SCRIPT"), fr = doc.createElement("iframe");
  out.push(sc.nodeName, fr.nodeName, sc.parentNode);
  return out.join(" ");
}
export function attributes(p) {
  const doc = p.doc, out = [];
  const el = doc.createElement("div");
  el.setAttribute("data-row", 3); el.setAttribute("class", "a"); el.className = "b c"; el.removeAttribute("data-row");
  el.textContent = 5;
  out.push(p.html(el), el.firstChild.data, el.firstChild.nodeType);
  el.textContent = "";
  out.push(el.firstChild, p.html(el));
  const t = doc.createTextNode("v");
  t.nodeValue = "w";
  out.push(t.data, t.nodeValue);
  el.appendChild(t);
  el.textContent = "z";
  out.push(t.parentNode, el.firstChild === t, el.firstChild.data, el.lastChild === el.firstChild);
  const inp = doc.createElement("input");
  inp.value = "q"; inp.checked = true;
  out.push(inp.value, inp.checked);
  out.push(el.getAttribute("class"), el.hasAttribute("data-row"), el.contains(el.firstChild), el.getRootNode() === el);
  el.setAttribute("title", { toString() { el.textContent = "inside"; return "obj"; } });
  out.push(el.getAttribute("title"), el.firstChild.data);
  return out.join(" ");
}
export function entries(p) {
  const doc = p.doc, out = [];
  let kept;
  const read = (n) => [n.firstChild.nodeName, n.lastChild.nodeName, n.firstChild.nextSibling === kept, kept.parentNode === n, kept.nextSibling, n.lastChild === kept].join(",");
  out.push(p.between(() => { const n = doc.createElement("ol"); kept = doc.createElement("li"); n.appendChild(kept); n.appendChild(doc.createElement("li")); return n; }, read));
  out.push(p.afterThrow((give) => { const n = doc.createElement("ol"); kept = doc.createElement("li"); n.appendChild(kept); give(n); throw new Error("out"); },
    (n) => [n.lastChild.nodeName, kept.nextSibling && kept.nextSibling.nodeName, n.firstChild === kept].join(",")));
  return out.join(" ");
}
export function reentry(p) {
  const doc = p.doc, out = [];
  let n, kept;
  p.returnThenMutate(() => { n = doc.createElement("ol"); kept = doc.createElement("li"); n.appendChild(kept); return n; });
  out.push(n.lastChild.nodeName, kept.nextSibling && kept.nextSibling.nodeName, n.lastChild === kept);
  p.throwThenMutate((give) => { n = doc.createElement("ol"); kept = doc.createElement("li"); n.appendChild(kept); give(n); throw new Error("out"); });
  out.push(n.lastChild.nodeName, kept.nextSibling && kept.nextSibling.nodeName, n.lastChild === kept);
  return out.join(" ");
}
