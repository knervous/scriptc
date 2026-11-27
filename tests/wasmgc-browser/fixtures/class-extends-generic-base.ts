// @expect: base 3
// @expect: arena:foliage 2 10
// @expect: pool:entity 2 20
// @expect: true true false
class Core { static tag = "core"; id = 1; describe(): string { return "base"; } }
abstract class ArenaFields extends Core {
  static readonly state: string = "arena-fields";
  count = 0;
}
class Actor { n = 0; constructor(n: number) { this.n = n; } }
class FoliageActor extends Actor { kind = "foliage"; }
class EntityActor extends Actor { kind = "entity"; }
class Arena<T extends Actor> extends ArenaFields {
  items: T[] = [];
  add(item: T): number { this.items.push(item); this.count += 1; return this.count; }
  total(): number { let s = 0; for (const i of this.items) s += i.n; return s; }
  label(): string { return "arena"; }
}
abstract class FoliageFields extends Arena<FoliageActor> {
  static readonly state2: string = "foliage-fields";
}
class FoliageArena extends FoliageFields {
  label(): string { return "arena:foliage"; }
  firstKind(): string { return this.items[0]!.kind; }
}
class EntityPool extends Arena<EntityActor> {
  label(): string { return "pool:entity"; }
  add(item: EntityActor): number { return super.add(item) + 0; }
}
const f = new FoliageArena();
f.add(new FoliageActor(3));
f.add(new FoliageActor(7));
const p = new EntityPool();
p.add(new EntityActor(8));
p.add(new EntityActor(12));
console.log(f.describe(), 3);
console.log(f.label(), f.count, f.total());
console.log(p.label(), p.count, p.total());
const a: Arena<FoliageActor> = f;
console.log(f instanceof Arena, a instanceof FoliageArena, p instanceof FoliageArena);
