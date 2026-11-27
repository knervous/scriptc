// DOM members called, read and written by name on page values (DOM_DIRECT:
// js.dom.* host imports), and on everything else that may stand in their
// place: each must behave as the generic member access does.
const errText = (e) => e.name === "RangeError" ? "RangeError:" + e.message : e.name;
export function build(dom) {
  const out = [], doc = dom.doc;
  const root = doc.createElement("div");
  const span = doc.createElement("span", { is: "x" });
  span.setAttribute("data-row", 3);
  span.setAttribute("class", "row");
  span.removeAttribute("class");
  const text = doc.createTextNode(42);
  const r1 = root.appendChild(span);
  const r2 = span.appendChild(text);
  out.push(r1 === span, r2 === text, root.firstChild === span, span.firstChild === text);
  out.push(span.nodeType, text.nodeType, span.ownerDocument === doc, text.nodeValue, dom.reads());
  const before = doc.createElement("b");
  root.insertBefore(before, span);
  root.insertBefore(doc.createElement("i"), null);
  out.push(dom.names(root));
  root.removeChild(before);
  text.nodeValue = "v2";
  span.textContent = "t" + 1;
  span.textContent = 5;
  out.push(span.textContent, text.nodeValue, dom.attrs(span), dom.names(root));
  let clicks = 0;
  span.onclick = () => { clicks++; return "clicked"; };
  out.push(dom.click(span), clicks, typeof span.onclick);
  span.addEventListener("click", () => {}, { capture: true });
  span.addEventListener("focus", null);
  out.push(dom.log());
  return out.join(" ");
}
export function overrides(dom) {
  const out = [], doc = dom.doc, child = doc.createElement("c");
  // An own property, a subclass method and a prototype patched after use.
  out.push(dom.own.appendChild(child), doc.createElement("special").appendChild(child));
  const node = doc.createElement("p");
  node.setAttribute("a", 1);
  dom.patch();
  node.setAttribute("b", 2);
  out.push(dom.attrs(node), dom.log());
  // Plain page objects, a page function, a Proxy (one get per access) and a symbol.
  const plain = dom.plain, fn = dom.fn, proxied = dom.proxied;
  out.push(plain.appendChild("x"), plain.setAttribute("k", "v"), plain.nodeType, plain.ownerDocument, plain.firstChild);
  out.push(fn.appendChild("y"), fn.nodeType, fn.firstChild);
  proxied.appendChild(child);
  out.push(proxied.nodeType, proxied.firstChild === child);
  proxied.textContent = "pt";
  out.push(dom.traps(), dom.log());
  const sym = dom.sym;
  out.push(sym.nodeType, sym.ownerDocument);
  return out.join(" ");
}
export function failures(dom) {
  const out = [], tryIt = (f) => { try { out.push("ok:" + f()); } catch (e) { out.push(errText(e)); } };
  const doc = dom.doc, node = doc.createElement("n");
  tryIt(() => node.createElement("x"));          // not a function on this receiver
  tryIt(() => dom.plain.removeChild(node));      // absent method on a plain object
  tryIt(() => dom.frozen.textContent = "x");     // accessor still runs on a frozen node
  tryIt(() => { "use strict"; dom.plain.textContent = "x"; return dom.plain.textContent; });
  tryIt(() => { dom.frozenPlain.textContent = 2; });
  tryIt(() => dom.throwing.textContent = 1);
  tryIt(() => dom.throwing.nodeType);
  let nothing = null;
  try { nothing.appendChild(node); } catch (e) { out.push(e.message); }
  try { nothing.nodeType; } catch (e) { out.push(e.message); }
  try { nothing.textContent = 1; } catch (e) { out.push(e.message); }
  // Other argument counts take the generic call.
  tryIt(() => node.appendChild());
  tryIt(() => node.setAttribute("only"));
  out.push(dom.attrs(node), dom.log());
  return out.join(" ");
}
export function compiled(dom, h) {
  // Compiled receivers with the same member names stay compiled.
  const out = [];
  const fake = { kids: [], appendChild(c) { this.kids.push(c); return this.kids.length; }, nodeType: 11, textContent: "" };
  out.push(fake.appendChild("a"), fake.appendChild("b"), fake.nodeType);
  fake.textContent = "own";
  out.push(fake.textContent, Object.keys(fake).join(","));
  // A compiled object or array stored through a DOM setter: the page sees one facade.
  const node = dom.doc.createElement("q"), payload = { tag: 1 };
  node.onclick = payload;
  h.auditKeep(payload);
  out.push(node.onclick === payload, h.auditKept() === node.onclick);
  const list = [1, 2];
  node.textContent = list;
  out.push(node.textContent, dom.log());
  return out.join(" ");
}
