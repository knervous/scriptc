import type { Arena } from "./arena.ts";
import { FoliageActor } from "./actor.ts";
export class Holder {
  arena: Arena<FoliageActor> | null = null;
  total(): number { return this.arena === null ? -1 : this.arena.count(); }
}
