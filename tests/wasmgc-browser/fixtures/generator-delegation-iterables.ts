// @native-only: the engine dyn model keeps the numbered divergence (return()/throw() do not forward through yield*) and fences iterable delegation
function* arr(): Generator<number, void, undefined> { yield* [1, 2, 3]; }
function* str(): Generator<string, void, undefined> { yield* "héy"; }
function* sets(): Generator<number, void, undefined> { yield* new Set([4, 5]); }
function* maps(): Generator<[string, number], void, undefined> { yield* new Map([["a", 1], ["b", 2]]); }
const out: unknown[] = [];
for (const x of arr()) out.push(x);
for (const x of str()) out.push(x);
for (const x of sets()) out.push(x);
for (const x of maps()) out.push(x);
console.log(JSON.stringify(out));
