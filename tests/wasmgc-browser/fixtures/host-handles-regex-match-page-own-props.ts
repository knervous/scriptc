// @options: {"hostHandles": true}
// A typed match result seen through an untyped (page) value is the one array: own index, input and groups, and a
// write through the untyped side or a string[] alias is visible on every side.
const text = "ab 12-zed cd";
const m = /(?<num>\d+)-(?<w>\w+)(?<o>q)?/.exec(text)!;
const a: any = m;
console.log(Object.keys(a).join(","), Reflect.ownKeys(a).join(","));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(a, "index")), JSON.stringify(Object.getOwnPropertyDescriptor(a, "input")));
console.log("groups" in a, "nope" in a, JSON.stringify(a));
const c = structuredClone(a);
console.log(Array.isArray(c), c.length, c.index, c.input, Object.keys(c).join(","), c.groups.num, c !== a);
console.log(a.index, a.input, a.groups.num, a.groups.w, a.groups.o, Object.keys(a.groups).join(","), a.groups === a.groups);
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
const back: RegExpExecArray = a;
console.log(back.index, back.input, back[1], back.groups!.num);
