// Index reads on strings held in dyn: constant, string-constant and computed
// keys, from TS any (native-any) and from JS code (native), and an object
// pattern over a string source.
import { strIndex } from "./defect-dyn-string-index-helper.js";
const s: any = "ab"; const i = 1;
console.log(s[0], s["1"], s[i], s[5], s.length);
console.log(strIndex("cd"));
function first(t0: any) { const { 0: c, length } = t0; return c + length; }
console.log(first("xy"));
