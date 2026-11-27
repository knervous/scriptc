// @native-any-only: an open typed record meets untyped code only in the native any model
// An open record (declared fields plus an index signature, or optional fields) seen through untyped code keeps every own entry:
// the declared fields that are set, then the overflow, in JS own-key order. Absent optional fields stay absent.
type Props = { children?: string; className?: string; [key: string]: unknown };
type Idx = { [key: string]: number };
const keysOf = (r: { [key: string]: unknown }): string => Object.keys(r).map((k) => k + "=" + String(r[k])).join(",");
const a: Props = { children: "kid", id: "keep", n: 1 };
console.log(keysOf(a));
a["extra"] = 2;
console.log(keysOf(a), Object.keys(a).join(","));
const b: Props = { className: "c", z: 1 };
console.log(keysOf(b));
const d: Props = {};
console.log(keysOf(d), "[" + Object.keys(d).join(",") + "]");
const x: any = a;
console.log(Object.keys(x).join(","), "id" in x, "className" in x, "children" in x, Object.prototype.hasOwnProperty.call(x, "n"), Object.prototype.hasOwnProperty.call(x, "className"));
console.log(Object.entries(x).map((e) => e[0] + ":" + String(e[1])).join(","), Object.values(x).join(","));
const seen: string[] = [];
for (const k in x) seen.push(k);
console.log(seen.join(","));
const idx: Idx = { u: 1, v: 2 };
const y: any = idx;
console.log(Object.keys(y).join(","), "u" in y, y.v, JSON.stringify(y), JSON.stringify(x), JSON.stringify([x, y]));
const target: any = { pre: 0 };
Object.assign(target, a);
console.log(Object.keys(target).join(","), target.id, target.extra);
const copy: any = { ...x };
console.log(Object.keys(copy).join(","));
