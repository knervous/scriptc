// A string module binding keeps one cached dyn box, cleared by every write;
// `new` with up to four arguments takes the direct construct path.
// @hits(native,native-any): ^\$dyn\.construct\.fixed$
// @hits(native,native-any): ^\$gbox\.get\.
import { holder, run, show } from './dyn-construct-boxes-helper.js';
var key: string = "first";
function rekey(k: string) { key = k; }
const a = holder(key, key);
rekey("second");
const b = holder(key, key);
key = key + "!";
const c = holder(key, key);
console.log(show(a, b, c));
const page: any = globalThis;
console.log(run(2, page.Map));
