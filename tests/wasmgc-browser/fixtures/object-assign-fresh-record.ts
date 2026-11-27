// Object.assign onto a fresh {} target copies the source's own keys.
const q = { k: "v", n: 2 };
const t = Object.assign({}, q);
console.log(JSON.stringify(t), Object.keys(t).join(","));
type P = { score: number; name: string };
const p: P = { score: 1, name: "x" };
console.log(JSON.stringify(Object.assign({}, p, { extra: true })));
const j = JSON.parse('{"z":1,"score":5,"name":"n"}') as P;
console.log(JSON.stringify(Object.assign({}, j)));
