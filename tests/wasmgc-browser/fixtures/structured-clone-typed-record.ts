// @native-only: the engine dyn model hands the page a facade, which the page's structuredClone refuses
// structuredClone of a statically typed value is an exact deep copy, undeclared keys of a record built from untyped data included.
type P = { score: number; name: string; tags: string[] };
const p: P = { score: 1, name: "x", tags: ["a"] };
const c = structuredClone(p);
c.tags.push("b");
c.score = 2;
console.log(JSON.stringify(p), JSON.stringify(c), c !== p, c.tags !== p.tags);
const j = JSON.parse('{"z":1,"score":5,"name":"n","tags":["t"],"more":{"deep":[1]}}') as P;
const d = structuredClone(j);
d.tags.push("u");
console.log(JSON.stringify(j), JSON.stringify(d));
console.log(Object.keys(d).join(","));
const a = [1, 2];
const b = structuredClone(a);
b.push(3);
console.log(JSON.stringify(a), JSON.stringify(b));
