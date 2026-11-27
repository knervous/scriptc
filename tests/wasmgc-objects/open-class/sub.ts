import { Base } from "./base";

// Overrides f in a module base.ts never sees.
export class Sub extends Base {
  f(): number {
    return super.f() + 1;
  }
}
