// @options: {"hostHandles": true}
// React DOM's canUseDOM: member reads on window/document through the typed DOM
// members (js.dom.get.document / head / activeElement / parentElement), never
// the generic js.get. Node has no window: the test is false there, as in JS.
const g = globalThis as any;
const canUseDOM = typeof g.window !== "undefined" && typeof g.window.document !== "undefined" && typeof g.window.document.createElement !== "undefined";
console.log(canUseDOM);
const fake: any = { document: { head: 1, activeElement: null, body: { parentElement: "p" } } };
console.log(fake.document.head, fake.document.activeElement, fake.document.body.parentElement);
