// @known-defect(engine,native,native-any,native-sim): a method shadowed through a COMPUTED key (target[key] = fn) cannot be honoured by statically dispatched calls: the write is refused loudly instead of being ignored
// @known-defect-expect: run: exit:1 compiled Box
class Box<T> {
  held: T;
  constructor(h: T) { this.held = h; }
  get value(): T { return this.read(); }
  read(): T { return this.held; }
  label(): string { return "box"; }
}
class NumBox extends Box<number> {
  double(): number { return this.read() * 2; }
}
const put = (target: object, key: string, value: unknown): void => {
  (target as Record<string, unknown>)[key] = value;
};
const b = new Box<string>("hi");
const n = new NumBox(4);
console.log(b.value, b.read(), b.label(), n.double(), n.value);
console.log(typeof b.read);
const other = new Box<number>(1);
put(other, "label", () => "replaced");
console.log(other.label(), b.label());
