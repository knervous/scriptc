// A subclass of a generic class instance (through an abstract intermediate) flows into a generic
// parameter typed with that base: the argument is the same instantiation seen from the subclass.
class Actor { id = 1; }
class Base<T extends Actor> {
  items: T[] = [];
  add(item: T): void { this.items.push(item); }
}
abstract class Fields extends Base<Actor> { tag = "f"; }
class Arena extends Fields { extra = 2; }
function draw<T extends Actor>(arena: Base<T>, name: string): string {
  return name + ":" + arena.items.length;
}
const arena = new Arena();
arena.add(new Actor());
arena.add(new Actor());
console.log(draw(arena, "a"), arena.tag, arena.extra);
const viaBase: Base<Actor> = arena;
console.log(viaBase.items.length);
export {};
