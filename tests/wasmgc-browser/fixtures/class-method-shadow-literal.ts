// @native-any-only: an any-typed receiver stays untyped only in the native any model
// An own property assigned over a prototype method shadows it for later calls (a literal key through an untyped receiver is observed
// by the whole program, so statically dispatched calls honour it).
class Box {
  held: string;
  constructor(h: string) { this.held = h; }
  read(): string { return this.held; }
  label(): string { return "box"; }
  describe(prefix: string): string { return prefix + this.label(); }
}
class NumBox extends Box {
  double(): string { return this.read() + this.read(); }
}
const b = new Box("hi");
const n = new NumBox("4");
const loose: any = b;
const looser: any = n;
console.log(b.label(), n.label(), n.describe(">"));
loose.label = () => "replaced";
looser["label"] = () => "also replaced";
console.log(b.label(), n.label(), b.describe("<"), n.describe(">"), n.double());
const other = new Box("1");
console.log(other.label());
