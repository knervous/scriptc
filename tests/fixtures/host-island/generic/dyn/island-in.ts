// `k in o` over island values held as untyped data: own properties (an own undefined included) and members the host
// answers. (A primitive operand answers false in the checked-dynamic tree by design, where JS throws: tsc admits `in`
// only on object-typed operands.)
const g: any = globalThis;
g.record = { a: 1, b: undefined };
const held: unknown = g.record;
const probe = (k: string, o: any): string => {
  try { return String(k in o); } catch (e) { return (e as Error).name; }
};
console.log(probe("a", held), probe("b", held), probe("z", held), probe("record", g), probe("nope", g));
