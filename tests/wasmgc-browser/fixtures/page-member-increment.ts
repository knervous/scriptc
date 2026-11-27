// `++`/`--` on a numeric member of a page object (a DOM element's tabIndex):
// the engine's read and write, prefix and postfix results.
const h: any = globalThis;
const doc: Document = h.auditDom().doc;
const el: HTMLElement = doc.createElement("div");
el.tabIndex = 3;
const before = el.tabIndex++;
const after = ++el.tabIndex;
el.tabIndex--;
console.log(before, after, el.tabIndex);
