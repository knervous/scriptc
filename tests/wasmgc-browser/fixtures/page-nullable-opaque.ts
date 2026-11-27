// A nullable compiled reference (`Entity | null`) handed to page code and
// taken back into a typed slot (React state's shape): identity is kept, the
// page sees null/undefined as its own, and both come back as themselves.
import { keep, take, kindOf } from "./page-nullable-opaque-helper.js";
class Entity {
  name: string;
  constructor(name: string) { this.name = name; }
  greet(): string { return `hi ${this.name}`; }
}
const target: Entity | null = new Entity("Ayla");
console.log(kindOf(target));
keep(target);
const back: Entity | null = take();
console.log(back === target, back ? back.greet() : "none");
const gone: Entity | null = null;
console.log(kindOf(gone));
keep(gone);
const empty: Entity | null = take();
console.log(empty === null);
const unset: Entity | undefined = undefined;
console.log(kindOf(unset));
keep(unset);
const stillUnset: Entity | undefined = take();
console.log(stillUnset === undefined);
