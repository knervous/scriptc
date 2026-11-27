// typeof === "object" from compiled JavaScript over typed records, typed arrays,
// class instances and errors (native dyn), next to the boxed primitives.
import { objectGate } from './r4-typed-helper.js';
class Pt { x: number; constructor(x: number) { this.x = x; } }
const rec: { n: number } = { n: 1 };
const arr: string[] = ["a", "b"];
const kids: string[] = new Array<string>(2); kids[0] = "x"; kids[1] = "y";
const out: string[] = [
  objectGate(rec), objectGate(arr), objectGate(kids), objectGate(new Pt(2)), objectGate(new Error("e")),
  objectGate("s"), objectGate(3), objectGate(true), objectGate(null), objectGate(undefined), objectGate(() => 1),
];
console.log(out.join(","));
