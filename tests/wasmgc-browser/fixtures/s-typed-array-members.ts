// @options: {"hostHandles": true}
// @native-any-only: the typed arrays and match results reach the members through an any receiver only in the native any model
// The Array members of typed arrays (number[], string[], record[]) and of regex match results seen through `any` resolve (slice, map, join, indexOf, ...), with the match's own index / input / groups.
import { run } from './s-typed-array-members-helper.js';
const recs = [{ k: 1 }, { k: 2 }, { k: 3 }];
console.log(run("Hello World" as any, [3, 1, 2] as any, ["a", "b", "c"] as any, recs as any));
