// A record holding a module namespace crosses into an untyped value (as a web app's records often do): its other
// fields read through `any`. The namespace itself is not printed: Node shows the namespace object, this lane its token.
import * as plugin from "./lib/plugin.js";
interface Holder { ns: typeof plugin; label: string; n: number }
const holder: Holder = { ns: plugin, label: "held", n: 3 };
const loose: any = holder;
console.log(loose.label, loose.n + 1, holder.ns.greet("typed"), "ns" in loose);
const list: any[] = [holder, { ns: plugin, label: "second", n: 5 }];
for (const h of list) console.log(h.label, h.n);
