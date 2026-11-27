// @native-only: the engine dyn lane answers these the old way (a separate, pre-existing gap); the fix is in the native class tables
// An instance held at its base class's static type (a `Base` binding, a `Base | string` union arm, a `Base`
// result) and handed to untyped code answers `instanceof` of its own class and its base (after upstream 8dbdee84d9,
// #3486). The class tables of the untyped value test classes exactly, and only the static type's class had an arm:
// once a union with the class arm reached untyped code, both tests answered false.
class Base { b = 1; }
class TNode extends Base { tag(): string { return "node"; } }
type U = Base | string | null;
function make(): U { return new TNode(); }
function makeBase(): Base { return new TNode(); }
function asNode(v: unknown): TNode | null { return v instanceof TNode ? v : null; }
console.log("union", asNode(make())?.tag() ?? "null");
console.log("base", asNode(makeBase())?.tag() ?? "null");
const u: U = new TNode();
const x: unknown = u;
console.log("direct", x instanceof TNode, x instanceof Base);
const arr: U[] = [new TNode(), "s", null];
console.log("arr", arr.map((v) => (v as unknown) instanceof TNode).join(","));

const w: Base = new TNode();
const y: unknown = w;
console.log("static base", y instanceof TNode, y instanceof Base);
class Leaf extends TNode { leaf = true; }
const deep: Base | null = new Leaf();
const z: unknown = deep;
console.log("two levels", z instanceof Leaf, z instanceof TNode, z instanceof Base, asNode(z)?.tag() ?? "null");
export {};
