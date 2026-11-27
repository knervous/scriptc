// @native-only: the engine dyn lane fails this with "Cannot read properties of null" (legacy lane; not investigated)
// A method called through its prototype-bag callback (the program touches `.prototype.tick`) with an argument whose
// checked conversion runs JavaScript getters that read `this`: the callee still sees its own receiver. Guards the
// invoker's order (arguments convert before the call-time receiver is set). Note: this passes on the compiler before
// that change too; the client failure it was meant for is not reproduced here.
import { makeEye } from "./dyn-receiver-getter-arguments-helper.js";
interface Eye { readonly x: number; readonly y: number }
class Ambient {
  private clock = 0;
  tick(delta: number, eye: Eye | null): void { this.clock += delta; console.log("tick", this.clock, eye ? eye.x + eye.y : -1); }
}
class Other { tick(): void { console.log("other"); } }
console.log(typeof Other.prototype.tick);
const ambient: Ambient | null = new Ambient();
const eye = makeEye(2) as Eye;
ambient?.tick(16, eye);
ambient?.tick(4, eye);
