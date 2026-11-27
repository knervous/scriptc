// @options: {"hostHandles": true}
// @native-any-only: match results carry index/input/groups only where untyped code receives them (TS any); the other lanes type the result as string[]
// A regex match entering untyped code under hostHandles is a real array with own data properties
// index, input and groups (RegExpBuiltinExec), built from the typed cursor.
const h: any = globalThis;
const text: string = h.auditIdentity("ab 12-zed cd 7-x9");
const show = (label: string, r: any): void => {
  if (r === null) { console.log(label, "null"); return; }
  const parts: string[] = [];
  for (let i = 0; i < r.length; i++) parts.push(r[i] === undefined ? "undef" : String(r[i]));
  console.log(label, Array.isArray(r), r.length, r.index, r.input, parts.join("|"), Object.keys(r).join(","), JSON.stringify(r));
};
const re = /(\d+)-(x)?(\w+)/;
const a: any = re.exec(text); show("exec", a);
const b: any = text.match(re); show("match", b);
const c: any = /q(\d)/.exec(text); show("miss", c);
const d: any = text.match(/zz/); show("missMatch", d);
// Named groups: groups is a null-prototype object of the named captures (undefined for a missing one).
const n: any = /(?<num>\d+)-(?<opt>q)?(?<word>\w+)/.exec(text);
show("named", n);
console.log(Object.keys(n.groups).join(","), n.groups.num, n.groups.opt, n.groups.word, Object.getPrototypeOf(n.groups) === null, "opt" in n.groups);
console.log(JSON.stringify(n.groups));
// No named groups: groups is an own property whose value is undefined.
console.log("groups" in a, a.groups === undefined, Object.prototype.hasOwnProperty.call(a, "groups"), Object.prototype.hasOwnProperty.call(a, "index"));
// Array behavior: spread, destructuring, methods, iteration.
const [whole, num, , word] : any[] = a;
console.log(whole, num, word, [...a].length, a.slice(1, 3).length, a.map((x: any) => x === undefined ? "u" : x.length).join("/"));
const joined: string[] = [];
for (const part of a) joined.push(String(part));
console.log(joined.join("+"), a.indexOf("12"), a.join("-"));
// A global String.match is a plain list: no index, input or groups.
const g: any = text.match(/\d+/g);
console.log(Array.isArray(g), g.length, g.index, g.input, g.groups, Object.keys(g).join(","));
// Own properties behave as data properties.
a.index = 99; a.extra = "x";
console.log(a.index, a.extra, Object.keys(a).join(","));
// A sticky regex's lastIndex advances; each exec result carries its own index.
const sticky = /\d/y; sticky.lastIndex = 3;
const s1: any = sticky.exec(text);
console.log(s1 === null ? "null" : s1.index, sticky.lastIndex);
const all = /\d+/g;
const idx: number[] = [];
for (let r: any = all.exec(text); r !== null; r = all.exec(text)) idx.push(r.index);
console.log(idx.join(","));
