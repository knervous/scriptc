// @native-only: the engine lane's dyn model reads a method replaced from JavaScript with a null receiver (it failed before reaching it too)
// A setter write (`mesh.material = m`) replaces no method: another class's `material(handle)` stays a static call. A
// TypeScript class's zero-argument void method is static too unless the program replaces it; a JavaScript helper's
// untyped write of that name is what observes it (class-callbacks.ts).
import { replaceNotify } from "./class-static-dispatch-setter-notify-helper.js";
class Mesh {
  private held = "none";
  get material(): string { return this.held; }
  set material(value: string) { this.held = value; }
}
class Applier {
  private readonly materials = new Map<number, string>([[1, "stone"], [2, "glass"]]);
  ticks = 0;
  material(handle: number): string {
    const found = this.materials.get(handle);
    if (found === undefined) throw new Error(`no material ${handle}`);
    return found;
  }
  tick(): void { this.ticks += 1; }
  apply(mesh: Mesh, handle: number): void {
    mesh.material = this.material(handle);
    this.tick();
  }
}
class Notifier {
  count = 0;
  notify(): void { this.count += 1; }
  fire(times: number): void { for (let i = 0; i < times; i++) this.notify(); }
}
const mesh = new Mesh();
const applier = new Applier();
applier.apply(mesh, 1);
console.log(mesh.material, applier.ticks);
applier.apply(mesh, 2);
console.log(mesh.material, applier.ticks);
try { applier.material(3); } catch (e) { console.log("threw", (e as Error).message); }
const quiet = new Notifier();
const loud = new Notifier();
quiet.fire(3);
replaceNotify(loud, () => console.log("replaced notify"));
loud.fire(2);
console.log(quiet.count, loud.count);
