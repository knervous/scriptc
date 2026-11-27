// @profile: reading a missing key of a typed record whose value type cannot hold undefined (here a function) is a TypeError at the read, not undefined (it was an unreachable trap); a number value reads undefined
// @expect: TypeError the record has no key 'missing' (its value type cannot hold undefined)
// @expect: undefined 1
// @expect: 2
const handlers: Record<string, (x: number) => number> = { a: (x) => x + 1 };
const counts: Record<string, number> = { a: 1 };
function pick(k: string) { return handlers[k]; }
try { pick("missing"); console.log("read"); } catch (e) { console.log((e as Error).name, (e as Error).message); }
console.log(counts["missing"], counts["a"]);
console.log(handlers["a"]!(1));
