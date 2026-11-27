import { Actor } from "./actor.ts";
import { ArenaFields } from "./fields.ts";
export class Arena<T extends Actor> extends ArenaFields {
  items: T[] = [];
  add(item: T): void { this.items.push(item); this.size += 1; }
}
