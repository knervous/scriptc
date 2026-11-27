// Short-circuit assignment to a static field through the declaring class's own name: the read
// happens once, the write only in the selected branch.
let built = 0;
class Mirror {
  private static shared: Mirror | null = null;
  static label = "";
  static hits = 0;
  readonly id = ++built;
  static get instance(): Mirror {
    Mirror.shared ??= new Mirror();
    return Mirror.shared;
  }
  static tag(name: string): string {
    Mirror.label ||= name;
    Mirror.hits &&= Mirror.hits + 10;
    return Mirror.label;
  }
}
console.log(Mirror.instance.id, Mirror.instance.id, built);
console.log(Mirror.tag("first"), Mirror.tag("second"), Mirror.hits);
Mirror.hits = 1;
console.log(Mirror.tag("third"), Mirror.hits);
export {};
