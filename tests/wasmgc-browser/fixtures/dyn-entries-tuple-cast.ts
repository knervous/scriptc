// Object.entries of an untyped value, cast to a tuple array: each element is checked into the tuple.
const a: any = JSON.parse('{"z":1,"name":"n"}');
const es = Object.entries(a) as [string, number | string][];
console.log(es.length, es[0]![0], es[0]![1], es[1]![0], es[1]![1]);
const lit: any = { k: "v", n: 2 };
const e2 = Object.entries(lit) as [string, number | string][];
console.log(e2.map((e) => e[0] + "=" + e[1]).join(","));
const x: any = ["z", 1];
const t = x as [string, number | string];
console.log(t[0], t[1]);
