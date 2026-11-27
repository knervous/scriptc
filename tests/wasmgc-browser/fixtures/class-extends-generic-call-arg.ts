// @expect: 2 foliage
// @expect: 2 entity
class Actor { n = 0; constructor(n: number) { this.n = n; } }
class FoliageActor extends Actor { kind = "foliage"; }
class EntityActor extends Actor { kind = "entity"; }
class Arena<T extends Actor> {
  items: T[] = [];
  add(item: T): void { this.items.push(item); }
  count(): number { return this.items.length; }
}
abstract class FoliageFields extends Arena<FoliageActor> {}
class FoliageArena extends FoliageFields {}
function draw<T extends Actor>(arena: Arena<T>, label: string): string {
  return arena.count() + " " + label;
}
const f = new FoliageArena();
f.add(new FoliageActor(2));
f.add(new FoliageActor(3));
console.log(draw(f, "foliage"));
const e = new Arena<EntityActor>();
e.add(new EntityActor(1));
e.add(new EntityActor(1));
console.log(draw(e, "entity"));
