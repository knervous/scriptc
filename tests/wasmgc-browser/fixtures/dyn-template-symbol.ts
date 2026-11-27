// A template literal applies ToString: a Symbol is JS's TypeError (String()
// and toString() still answer "Symbol(x)").
import { run, sym } from "./dyn-template-symbol-helper.js";
console.log(run(sym()));
const s: any = sym();
try { console.log(`${s}`); } catch (e) { console.log((e as Error).message); }
console.log(String(s), `${JSON.parse("[1,2]")}`);
