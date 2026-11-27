// @options: {"hostHandles": true}
// DOM_DIRECT attributes id / className / title / hidden / tabIndex / dir / lang: get and set
// through their own typed members; values round-trip exactly as the DOM defines them.
const h: any = globalThis;
const doc: Document = h.auditDom().doc;
const el: HTMLElement = doc.createElement("div");
el.id = ""; el.className = ""; el.title = ""; el.hidden = false; el.tabIndex = 0; el.dir = ""; el.lang = "";
console.log([el.id, el.className, el.title, el.hidden, el.tabIndex, el.dir, el.lang].join(","));
el.id = "a1"; el.className = "x y"; el.title = "t"; el.hidden = true; el.tabIndex = 3; el.dir = "rtl"; el.lang = "de";
console.log([el.id, el.className, el.title, el.hidden, el.tabIndex, el.dir, el.lang].join(","));
el.hidden = false; el.tabIndex = -1; el.dir = "bogus";
console.log(([el.hidden, el.tabIndex, el.dir].join(",")));
// Untyped receiver: the same members through page values of unknown type.
const any: any = el;
any.id = 7; any.title = null; any.lang = undefined;
console.log(([any.id, any.title, any.lang, typeof any.id].join(",")));
// A plain page object takes the same named reads and writes.
const plain: any = h.auditDom().plain;
plain.id = 5; plain.hidden = "no"; plain.className = "c"; plain.tabIndex = 2;
console.log(plain.id, plain.hidden, plain.className, plain.tabIndex);
