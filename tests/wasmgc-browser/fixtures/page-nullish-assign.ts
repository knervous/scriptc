// @native-only: engine dyn refuses this callback signature crossing into page code at compile time (its own limit)
// `||=` and `??=` on members of a page object (a DOM element): the engine's
// own read, and the write only when the branch is taken.
const h: any = globalThis;
const doc: Document = h.auditDom().doc;
const el: HTMLElement = doc.createElement("div");
let calls = 0;
const title = (el.title ||= "untitled");
const again = (el.title ||= "ignored");
el.onclick ??= () => { calls++; return null; };
const first = el.onclick;
el.onclick ??= () => null;
console.log(title, again, el.title, typeof el.onclick, el.onclick === first);
