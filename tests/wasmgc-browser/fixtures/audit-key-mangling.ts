// Constant-key reads whose keys mangled to the same helper name: the typed
// per-key readers collided (a compile crash), the outlined slow readers and
// the typed field readers deduplicated (the second key read the first's value).
import { oddKeys, readRecord } from "./audit-key-mangling-helper.js";
const h: any = globalThis;
console.log(oddKeys(h.auditMake()));
const r = { "-": 1, "_2d": 2, "a.b": 3, "a_2eb": 4, "é": 5, "_e9": 6 };
console.log(readRecord(r));
r["-"] = 10; r._2d = 20;
console.log(readRecord(r), r["-"], r._2d);
const a: any = r;
console.log(a["-"], a._2d, a["a.b"], a.a_2eb, a.é, a._e9);
