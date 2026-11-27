// A RECORD that passes through a dynamic slot (`any`, a Map value, a WeakMap value) comes back as the same struct:
// `===` holds and writes through either alias are seen through the other. The guard beside the known defect
// dyn-record-view-identity (an object CREATED dynamic and viewed as a record is copied).
interface Block { frame: number; readonly data: number[] }
class World { readonly id: number; constructor(id: number) { this.id = id; } }
const blocks = new WeakMap<World, Block>();
const byKey = new Map<string, Block>();
const w = new World(1);
blocks.set(w, { frame: 0, data: [1] });
byKey.set("a", { frame: 0, data: [2] });
const b = blocks.get(w)!; b.frame = 7;
const k = byKey.get("a")!; k.frame = 9;
console.log(blocks.get(w)!.frame, blocks.get(w) === b, byKey.get("a")!.frame, byKey.get("a") === k);
const rec: Block = { frame: 2, data: [3] };
const boxed: any = rec;
const back: Block = boxed;
back.frame = 6;
boxed.frame += 1;
console.log(rec.frame, back.frame, back === rec, boxed === rec);
const registry = new Set<Block>([rec]);
console.log(registry.has(back));
