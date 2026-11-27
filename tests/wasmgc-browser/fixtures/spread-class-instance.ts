// Spreading a class instance into a literal copies its own data fields (inherited
// included); accessors and methods live on the prototype and are not copied, later
// keys win, and fields the literal's type does not declare are dropped.
class Base { id = 1; tag = "base"; }
class Node2 extends Base {
  name: string;
  scale = 2;
  private secret = 7;
  constructor(name: string) { super(); this.name = name; }
  get doubled(): number { return this.scale * 2; }
  reveal(): number { return this.secret; }
}
type Clone = { id: number; tag: string; name: string; scale: number; doubled: number };
function clone(n: Node2): Clone {
  return { ...n, doubled: n.doubled, name: n.name + "_clone" };
}
const c = clone(new Node2("a"));
console.log(c.id, c.tag, c.name, c.scale, c.doubled);
const plain = { ...new Node2("b"), extra: 1 };
console.log(plain.name, plain.scale, plain.extra, plain.id);
export {};
