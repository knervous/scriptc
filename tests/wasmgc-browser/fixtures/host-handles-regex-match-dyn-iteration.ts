// @options: {"hostHandles": true}
// @native-any-only: TS `any` iteration over a typed match result
// Iteration, Set/Map construction and Array.from over a typed match result seen untyped see the elements only
// (not index, input or groups), and a write through the untyped side reaches the typed result.
const m = /(\d+)-(\w+)(q)?/.exec("ab 12-zed")!;
const a: any = m;
const seen: string[] = [];
for (const x of a) seen.push(String(x));
console.log(seen.join("|"));
console.log([...new Set(a)].length, Array.from(a).length);
console.log(Object.keys(a).join(","), a.map((x: any) => x === undefined ? "u" : x).join("|"));
a.forEach((_x: any, i: number) => { if (i === 1) a[1] = "changed"; });
console.log(m[1], a.indexOf("zed"), a.includes("changed"), a.length);
