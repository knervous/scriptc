// @known-defect(engine): engine dyn has no class values: `new this.constructor(...)` refuses at run time (never an invalid module: the gate rejects those outright)
// @known-defect-expect: run: exit:1 does not support library function dyn.classIs
// A class cloning itself through its own constructor value (three.js's Object3D.clone / BufferAttribute.clone shape).
import { Base, Derived, cloneAll } from "./class-new-this-constructor-helper.js";
const copies = cloneAll([new Base(1), new Derived(2)]);
console.log(copies.length, copies[0]!.v, copies[1]!.v, copies[1] instanceof Derived, copies[0] instanceof Derived);
