// @known-defect(engine, native): a TS any array pattern over a compiled array whose page facade got an own Symbol.iterator from the page binds the elements instead of running that iterator
// A compiled array the page has given its own Symbol.iterator: an array
// pattern over TS any runs that iterator (native-any takes the real protocol
// for every array that has crossed to the page).
import { arr } from "./ts-any-array-pattern-helper.js";
const page: any = globalThis;
function pair(t0: any) { const [a, b] = t0; return String(a) + ":" + String(b); }
const owned = arr(1, 2);
page.w5OwnIterator(owned);
console.log("own", pair(owned));
