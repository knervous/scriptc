// Array callbacks over arrays that shrink or grow during the walk.
import { shrinkWalks } from "./audit-callback-shrink-helper.js";
const h: any = globalThis;
console.log(shrinkWalks(h.auditIdentity));
// The same over TS any arrays with typed closures (native-any direct loops).
const mk = (): any => [1, 2, 3, 4];
let a = mk(), seen = "";
a.find((x: any) => { seen += x + "/"; a.pop(); return false; });
console.log("tsFind:" + seen);
a = mk(); seen = "";
console.log("tsFindIndex:" + a.findIndex((x: any) => { seen += x + "/"; a.pop(); return x === undefined; }) + ":" + seen);
