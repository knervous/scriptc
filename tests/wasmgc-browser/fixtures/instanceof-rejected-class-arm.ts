// @refuse: 'instanceof' on a union with an arm whose class has no lowering
// An `instanceof` test on a union with an arm whose class declaration is refused (an index signature, after
// upstream 9365-instanceof-union-indexed-class-arm) is refused beside the class's own diagnostic; the union test
// helper threw an internal "unknown class" error.
class Absent extends Error {
  depth: number;
  [key: string]: unknown;
  constructor(what: string, depth: number) { super(what); this.depth = depth; }
}
class Entry {
  name: string;
  constructor(name: string) { this.name = name; }
}
function lookup(name: string): Entry | Absent {
  return name.startsWith("x") ? new Absent("no such entry", 2) : new Entry(name);
}
function depthOf(value: Entry | Absent): number {
  return value instanceof Absent ? value.depth : 0;
}
console.log(depthOf(lookup("a")), lookup("x") instanceof Error);
export {};
