// @hits: \$once\.\$jsfn\.helper
// Array patterns over TS any run through one engine helper, built once and
// reused by every evaluation: values, holes, defaults (evaluated per run, in
// order), rest, strings and iterables stay per call.
import { arr, pageSet } from "./js-destructure-helper-once-helper.js";
let order = "";
const note = (s: string) => { order += s + ","; return s; };
function pair(t0: any) { const [a, b] = t0; return a + ":" + b; }
function withDefault(t0: any) { const [a = note("da"), , c = note("dc")] = t0; return a + ":" + c; }
function rest(t0: any) { const [h, ...tl] = t0; return h + "|" + tl.join(","); }
const out: string[] = [];
for (let i = 0; i < 3; i++) out.push(pair(arr(i, i * 2)));
out.push(pair("xy"), pair(pageSet(7, 8)), pair(JSON.parse("[5,6]")));
for (let i = 0; i < 2; i++) out.push(withDefault(i ? arr(1, 2, 3) : arr()) + "/" + order);
out.push(rest(arr(1, 2, 3)), rest(arr(9)));
let msg = ""; try { pair(null); } catch (e) { msg = (e as Error).name; }
out.push(msg);
console.log(out.join(" "));
