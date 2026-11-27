// Builtin members of values held as TS any: inherited prototype members read
// as values, and a compiled function's own name, length and prototype.
const arr: any = JSON.parse("[1,2,3]");
const s: any = JSON.parse('"abc"');
const n: any = JSON.parse("3.14159");
const rec: any = JSON.parse('{"a":1}');
console.log(typeof arr.map, typeof s.toUpperCase, typeof n.toFixed, typeof rec.valueOf, typeof rec.constructor);
console.log(arr.map === arr.map, s.toUpperCase === s.toUpperCase);
const m = arr.map;
console.log(m.call(arr, (x: number) => x * 2).join(","));
const up = s.toUpperCase;
console.log(up.call(s));
const f: any = function named(a: number, b: number) { return a + b; };
console.log(f.name, f.length, typeof f.call, typeof f.bind, typeof f.apply);
const ar: any = (x: number) => x;
console.log(ar.prototype === undefined, typeof f.prototype);
