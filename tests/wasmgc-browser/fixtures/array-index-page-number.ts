// @options: {"interfaceClassArms": true}
// An array indexed by a number read off an `any` object (parsed glTF JSON:
// `offsets[bv.buffer ?? 0]`, `accessors[p.attributes[k]]`): the index exits as
// the number it is, for reads, writes and optional-chain reads alike.
const h: any = globalThis;
const json: any = h.auditIdentity({ views: [{ buffer: 1, at: 0 }, { at: 2 }], attributes: { POSITION: 2, NORMAL: 0 } });
const offsets: number[] = [10, 20, 30];
let sum = 0;
for (let i = 0; i < json.views.length; i++) sum += offsets[json.views[i].buffer ?? 0]!;
console.log(sum);
const accessors: any[] = [{ n: "a" }, { n: "b" }, { n: "c" }];
const names: string[] = [];
names.push(accessors[json.attributes.POSITION].n, accessors[json.attributes.NORMAL].n);
console.log(names.join());
const table: (number[] | undefined) = [1, 2, 3];
console.log(table?.[json.views[0].at], table?.[json.views[1].at]);
const out: number[] = [0, 0, 0];
out[json.attributes.POSITION] = 7;
out[json.attributes.NORMAL] += 5;
console.log(out.join());
