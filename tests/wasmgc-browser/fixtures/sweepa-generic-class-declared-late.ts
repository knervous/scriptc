// @options: {"interfaceClassArms": true}
// A structural interface whose method takes an instantiation of a generic class declared LATER in
// the file than the first class that mentions the interface. The interface must map to the same
// instantiation however early it is first reached.
interface Item { id: number }
interface World {
  drain(arena: Arena<Item>, scale: number): number;
}
class Frontend {
  world: World | null = null;
  attach(world: World): void { this.world = world; }
  run(arena: Arena<Item>): number { return this.world ? this.world.drain(arena, 2) : -1; }
}
class RealWorld {
  drain(arena: Arena<Item>, scale: number): number { return arena.total() * scale; }
}
class Arena<T extends Item> {
  items: T[] = [];
  add(item: T): void { this.items.push(item); }
  total(): number { let s = 0; for (const i of this.items) s += i.id; return s; }
}
const arena = new Arena<Item>();
arena.add({ id: 3 });
arena.add({ id: 4 });
const front = new Frontend();
console.log(front.run(arena));
front.attach(new RealWorld());
console.log(front.run(arena));
const literalWorld: World = { drain: (a, k) => a.items.length * k };
front.attach(literalWorld);
console.log(front.run(arena));
