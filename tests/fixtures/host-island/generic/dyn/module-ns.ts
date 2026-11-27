// Module namespace values in unions and records, and their truthiness (truthy / type / dynMatch of moduleNs).
import * as plugin from "./lib/plugin.js";
type Plugin = typeof plugin;
interface Slot { ns: Plugin | null; label: string }
let current: Plugin | undefined;
const slot: Slot = { ns: null, label: "s" };
function load(on: boolean): void { current = on ? plugin : undefined; slot.ns = on ? plugin : null; }
for (const on of [false, true]) {
  load(on);
  console.log(on, current ? current.greet("a") : "none", slot.ns ? slot.ns.name : "empty", !!current, current === undefined);
}
