// A field the constructor assigns after super() (whose base constructor hands `this` out) is exposed; a derived class
// may re-type it with `declare`, and a union of the derived classes reads and writes it through its members.
class Node0 {
  readonly tag = "n";
  constructor() { this.init(); }
  init(): void {}
}
class Base extends Node0 {
  readonly kind: string;
  note?: string;
  level: number;
  constructor(kind: string, level: number) {
    super();
    this.kind = kind;
    this.level = level;
  }
}
class A extends Base {
  declare readonly kind: "a";
  size = 1;
  constructor() { super("a", 3); }
}
class B extends Base {
  declare readonly kind: "b";
  mass = 2;
  constructor() { super("b", 4); }
}
const items: (A | B)[] = [new A(), new B()];
for (const it of items) {
  it.level += 1;
  it.note = it.kind + it.level;
  console.log(it.kind, it.level, it.note, it instanceof A ? it.size : (it as B).mass);
}
