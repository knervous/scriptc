// @hits(native, native-any): \$switch\.atoms\.
// A string switch over an untyped value whose string knows its atom (for-in
// and Object.keys keys, literals) dispatches on the atom; computed and page
// strings compare by content; other kinds match no label; a repeated label
// keeps its first case; small switches too.
import { keysOf, objKeys, literals, computed, nonStrings, types } from "./js-switch-atoms-helper.js";
const page: any = globalThis;
const o: any = { children: 1, className: 2, "data-row": 3, onClick: 4, a: 5, b: 6, "": 7, "0": 8, "héllo": 9, other: 10 };
console.log(keysOf(o));
console.log(objKeys(o));
console.log(literals(), computed(), nonStrings(), types());
console.log(keysOf(page.auditMake2()), keysOf(JSON.parse('{"style":1,"constructor":2,"x":3}')));
