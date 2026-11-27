// A TS tuple held through TS `any` (and handed to the page) keeps its
// identity: reads and writes on either side reach the same tuple.
const h: any = globalThis;
const t: [string, number] = ["x", 1];
h.auditKeep(t);
const back: any = h.auditKept();
console.log(back === t);
h.auditWrite(t);
console.log(t[1]);
const p: [number, string] = [1, "a"];
const a: any = p, b: any = p;
console.log(a === b, a === p, h.auditIs2(a, p));
a[0] = 5;
console.log(p[0], a[0], a.length, Array.isArray(a), 1 in a, 2 in a);
for (let i = 0; i < a.length; i++) console.log("at", a[i]);
const [u, v] = a;
console.log(u, v, JSON.stringify(a), String(a));
const typedBack: [number, string] = a;
console.log(typedBack === p);
// Arrays of tuples: the outer array and each element keep identity.
const list: [string, number][] = [["a", 1], ["b", 2]];
const al: any = list;
console.log(al[0] === list[0], al.length, al.map((e: any) => e[0] + e[1]).join(";"));
al[1][1] = 7;
console.log(list[1][1]);
h.auditKeep(al);
console.log(h.auditKept() === al, h.auditKept()[0] === list[0]);
// A tuple inside a union arm.
const un: [number, number] | string = Math.random() > 2 ? "s" : [3, 4];
const au: any = un;
au[0] = 9;
console.log((un as [number, number])[0]);
const m = new Map<string, number>([["k", 1]]);
const ents: any = [...m.entries()];
console.log(JSON.stringify(ents), ents[0].length, Array.isArray(ents[0]));
