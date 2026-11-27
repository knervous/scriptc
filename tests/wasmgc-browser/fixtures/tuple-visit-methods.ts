// every/some/forEach on tuples: element order, the index argument,
// short-circuiting (calls stop at the deciding element), truthy non-boolean
// results, a mixed-element tuple and a readonly tuple.
type V3 = [number, number, number];
const v: V3 = [3, -1, 4];
const seen: string[] = [];
console.log(v.every((x, i) => (seen.push(`e${i}`), x > 0)), seen.join(","));
seen.length = 0;
console.log(v.some((x, i) => (seen.push(`s${i}`), x < 0)), seen.join(","));
seen.length = 0;
console.log(v.some((x) => x > 10), v.every((x) => x > -5));
let sum = 0;
v.forEach((x, i) => { sum += x * (i + 1); });
console.log(sum);
const mixed: [string, number] = ["a", 0];
console.log(mixed.some((x) => x), mixed.every((x) => x));
const ro: readonly [number, number] = [1, 2];
ro.forEach((x) => seen.push(String(x)));
console.log(seen.join(","), ro.every((x) => x));
