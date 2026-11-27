// Class slots holding a collection the page owns (a WeakMap is always the
// engine's on the browser target): an instance field and a static field.
class Node2 {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
class Registry {
  private static readonly seen = new WeakMap<Node2, number>();
  private readonly tags = new WeakMap<Node2, string>();

  add(node: Node2, tag: string): void {
    this.tags.set(node, tag);
    Registry.seen.set(node, (Registry.seen.get(node) ?? 0) + 1);
  }
  describe(node: Node2): string {
    return `${node.name}:${this.tags.get(node) ?? "-"}:${Registry.seen.get(node) ?? 0}`;
  }
}
const a = new Node2("a");
const b = new Node2("b");
const registry = new Registry();
registry.add(a, "first");
registry.add(a, "again");
console.log(registry.describe(a));
console.log(registry.describe(b));
const other = new Registry();
other.add(b, "x");
console.log(other.describe(b), other.describe(a));
