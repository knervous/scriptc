// @native-any-only: TS `any` reflection over the typed result (the other lanes lack hasOwnProperty/spread on any)
// A typed match result seen from untyped code is the one array: own index, input and groups in every reflection
// (keys, descriptors, assign, spread, clone), and a write through the untyped side or through a string[] alias is
// visible on every side.
const text = "ab 12-zed cd";
const m = /(?<num>\d+)-(?<w>\w+)(?<o>q)?/.exec(text)!;
const a: any = m;
console.log(Object.keys(a).join(","));
console.log(Reflect.ownKeys(a).join(","));
const ks: string[] = [];
for (const k in a) ks.push(k);
console.log(ks.join(","), Object.entries(a).map((e: any) => e[0]).join(","));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(a, "index")), JSON.stringify(Object.getOwnPropertyDescriptor(a, "input")));
console.log(Object.getOwnPropertyDescriptor(a, "groups")!.enumerable, Object.getOwnPropertyDescriptor(a, "nope"), JSON.stringify(Object.getOwnPropertyDescriptor(a, "1")));
console.log(Object.prototype.hasOwnProperty.call(a, "index"), "groups" in a, "nope" in a);
console.log(JSON.stringify(a));
const c = structuredClone(a);
console.log(Array.isArray(c), c.length, c.index, c.input, Object.keys(c).join(","), c.groups.num, c !== a);
const sp = [...a];
console.log(sp.length, sp.join("|"), Object.keys(sp).join(","));
const tgt: any = {};
const as = Object.assign(tgt, a);
console.log(Object.keys(as).join(","), as.index, as[1], as.groups.w);
const ob = { ...a };
console.log(Object.keys(ob).join(","));
console.log(a.groups === a.groups, Object.getPrototypeOf(a.groups) === null, Object.keys(a.groups).join(","));

// Writes are visible on every side: the typed result, a string[] alias and the untyped view are one array.
const alias: string[] = m;
alias[1] = "ALIAS";
console.log(a[1], m[1]);
a[2] = "UNTYPED";
console.log(alias[2], m[2], a.length);
a.index = 99;
console.log(m.index, a.index);
a.input = "replaced";
console.log(m.input, a.input);
a.push("tail");
console.log(m.length, alias.length, alias[alias.length - 1]);
Object.defineProperty(a, "index", { value: 7, writable: true, enumerable: true, configurable: true });
console.log(m.index, Object.keys(a).join(","));
const back: RegExpExecArray = a;
console.log(back === m, back.index, back[1]);
