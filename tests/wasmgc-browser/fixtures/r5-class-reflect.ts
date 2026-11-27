// @native-only: class instances are opaque references in engine dyn (no class facade there yet)
// Reflection on typed class instances from untyped code: in, Object.keys, hasOwnProperty, Object.hasOwn.
import { reflectShape } from './r5-helper.js';
class Base { name: string; constructor(n: string) { this.name = n; } greet(): string { return "hi " + this.name; } get label(): string { return "<" + this.name + ">"; } }
class Derived extends Base { sides: number; side: number; constructor(s: number) { super("sq"); this.side = s; this.sides = 4; } }
console.log(reflectShape(new Derived(3)) + " / " + reflectShape(new Base("b")));
