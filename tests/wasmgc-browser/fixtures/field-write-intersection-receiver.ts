// @options: {"interfaceClassArms": true}
// @known-defect(engine): engine dyn checks the tuple field read through the intersection with dynCheck-to-tuple-record, which the backend has no lowering for (pre-existing; ledger F004)
// @known-defect-expect: compile: dynCheck to a tuple record
// Property writes through an intersection receiver, LightBase & refinement:
// base fields and refinement fields are read and written through the
// intersection, a tuple element is written in place, and another alias of
// the same object sees every write. A light without the optional fields
// reads undefined for them.
interface LightBase { intensity: number; kind: string }
type Light = LightBase & { diffuse?: [number, number, number]; range?: number };

const light: Light = { intensity: 1, kind: "spot", diffuse: [1, 0.5, 0.25], range: 4 };
const alias: Light = light;
const bare: Light = { intensity: 0, kind: "dir" };

function tune(l: Light, k: number): void {
  l.intensity = l.intensity * k;
  l.kind = l.kind + "!";
  if (l.diffuse) {
    l.diffuse[0] = l.diffuse[0] * k;
    l.diffuse[2] = 0;
  }
  l.range = (l.range ?? 0) + k;
}

tune(light, 2);
tune(bare, 3);
console.log(light.intensity, light.kind, light.diffuse?.join(","), light.range);
alias.range = 100;
alias.intensity += 0.5;
if (alias.diffuse) alias.diffuse[1] = 0.75;
console.log(light.intensity, light.kind, light.diffuse?.join(","), light.range, alias === light, alias.diffuse === light.diffuse);
console.log(bare.intensity, bare.kind, bare.diffuse, bare.range);
