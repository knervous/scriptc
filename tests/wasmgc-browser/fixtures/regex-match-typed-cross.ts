// A typed match result crossing into untyped code is the same real array the untyped path builds
// (own index, input and groups, in that order), with a stable identity; matchAll rows carry them too.
const text = "ab 12-zed cd 7";
const m = /(?<num>\d+)-(?<word>\w+)(?<opt>q)?/.exec(text)!;
const a: any = m;
const b: any = m;
console.log(a.index, a.input, a.length, a[1], Object.keys(a).join(","), a.groups.num, a.groups.opt, Object.getPrototypeOf(a.groups) === null);
console.log(a === b, Array.isArray(a), Object.keys(a.groups).join(","));
console.log(JSON.stringify(a));
function back(x: RegExpExecArray): string { return x.index + ":" + x.input + ":" + x[1]; }
console.log(back(a));
const plain = /(\d)-(\w)/.exec(text)!;
const pa: any = plain;
console.log(pa.index, pa.groups, Object.keys(pa).join(","), "groups" in pa);
const g: any = text.match(/\d+/g);
console.log(Array.isArray(g), g.index, g.input, g.groups, Object.keys(g).join(","));
for (const r of text.matchAll(/(\d)/g)) console.log(r.index, r.input, r[1], r.groups);
const rows = [...text.matchAll(/(?<d>\d)(?<e>\d)?/g)];
console.log(rows.map(r => r.index).join(","), rows[0]!.input, rows[0]!.groups !== undefined, rows[1]!.groups?.d, rows[1]!.groups?.e);
const ra: any = rows[0];
console.log(ra.index, Object.keys(ra).join(","), ra.groups.d, ra.groups.e);
