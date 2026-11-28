// @native-any-only: typed symbols reach untyped code in the native any model
// Typed symbols entering untyped code: compared with `===` against dynamic values (an element-type switch), stored as
// values and keys, read back, `typeof` and `description` on the dynamic side, and registered symbols' identity.
const ELEMENT = Symbol.for("demo.element");
const PORTAL = Symbol.for("demo.portal");
const MEMO = Symbol.for("demo.memo");
const LOCAL = Symbol("demo.local");
function tagOf(node: any): string {
  switch (node.$$typeof) {
    case ELEMENT: return "element";
    case PORTAL: return "portal";
    case MEMO: return "memo";
    case LOCAL: return "local";
    default: return "other";
  }
}
function same(a: any, b: unknown): boolean { return a === b; }
const nodes: any[] = [{ $$typeof: ELEMENT }, { $$typeof: Symbol.for("demo.portal") }, { $$typeof: MEMO }, { $$typeof: LOCAL },
  { $$typeof: Symbol("demo.local") }, { $$typeof: "demo.memo" }, { $$typeof: undefined }, {}];
console.log(nodes.map(tagOf).join(","));
console.log(same(ELEMENT, Symbol.for("demo.element")), same(LOCAL, LOCAL), same(LOCAL, Symbol("demo.local")), same(ELEMENT, "demo.element"), same(ELEMENT, null));
const box: any = {};
box.kind = MEMO;
box[ELEMENT] = "keyed";
console.log(box.kind === MEMO, box[ELEMENT], box[Symbol.for("demo.element")], typeof box.kind, String(box.kind.description), box.kind.toString());
const list: any[] = [ELEMENT, PORTAL, LOCAL];
console.log(list.indexOf(PORTAL), list.includes(LOCAL), list.indexOf(Symbol("demo.local")), typeof list[2]);
const back: symbol = box.kind;
console.log(same(back, MEMO), back.description);
