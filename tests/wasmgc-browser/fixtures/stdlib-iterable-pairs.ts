// @native-only: engine-dyn emitter lacks dynIterN (array destructuring of a dyn element)
// @options: {"interfaceClassArms": true}
// Iterable<[K, V]> parameter fed by a Map, an array of pairs and Map.entries().
function pairs(xs: Iterable<[string, number]>): string { const out: string[] = []; for (const [k, v] of xs) out.push(k + "=" + v); return out.join(";"); }
console.log(pairs(new Map([["a", 1], ["b", 2]])), pairs([["z", 26]]), pairs(new Map([["q", 5]]).entries()));
