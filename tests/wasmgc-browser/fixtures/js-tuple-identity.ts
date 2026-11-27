// A typed tuple handed to compiled untyped code is the same tuple there:
// identity holds and writes reach the typed side.
import { poke, same, keep, kept, walk, spread } from "./js-tuple-identity-helper.js";
const t: [string, number] = ["a", 1];
const r = poke(t);
console.log(t[1], same(r, t), same(t, t));
keep(t);
const back: [string, number] = kept();
console.log(back === t, back[1]);
const list: [string, number][] = [["x", 1], ["y", 2]];
console.log(walk(list));
console.log(spread(t));
