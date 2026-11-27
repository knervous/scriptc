// @expect: -1
// @expect: 2 fields
import { Holder } from "./class-extends-generic-order-lib/holder.ts";
import { Arena } from "./class-extends-generic-order-lib/arena.ts";
import { FoliageActor } from "./class-extends-generic-order-lib/actor.ts";
abstract class FoliageFields extends Arena<FoliageActor> {}
class FoliageArena extends FoliageFields {}
const h = new Holder();
console.log(h.total());
const a = new FoliageArena();
a.add(new FoliageActor(1));
a.add(new FoliageActor(2));
h.arena = a;
console.log(h.total() + " " + FoliageArena.tag);
