// Array.prototype.toReversed on typed arrays: a reversed copy, the original untouched, holes read as undefined.
// (grass-suitability.ts createGrassSuitability.)
const weights = [0.1, 0.5, 0.9, 1];
const rev = weights.toReversed();
console.log(rev.join(","), weights.join(","), rev !== weights);
const names = ["a", "b", "c"];
console.log(names.toReversed().join(""), [].toReversed().length);
const objs = [{ n: 1 }, { n: 2 }];
const r = objs.toReversed();
console.log(r[0] === objs[1], r.map((o) => o.n).join(","));
const holes: (number | undefined)[] = [1, , 3];
const hr = holes.toReversed();
console.log(hr.length, 1 in hr, hr[1], 1 in holes);
