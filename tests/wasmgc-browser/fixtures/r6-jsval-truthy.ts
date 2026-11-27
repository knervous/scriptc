// Truthiness of page (jsval) values in typed code: && / || / ! / ternaries and
// array callbacks returning a page value (React's filter over state arrays).
import { falsyValues } from './r6-accessor-helper.js';
const h: any = globalThis;
const vals: any = h.auditIdentity(falsyValues());
let out = "";
for (let i = 0; i < 10; i++) {
  const v: any = vals[i];
  out += (v ? "T" : "F") + (v || "o") + (v && "a") + (!v ? "n" : "y") + ",";
}
console.log(out);
const picked: any = vals.filter((v: any) => v || false);
console.log(String(picked.length));
