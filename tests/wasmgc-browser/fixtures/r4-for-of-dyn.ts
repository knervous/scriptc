// for-of in compiled JavaScript over untyped iterables (the dyn iteration protocol).
import { forOfAll } from './r4-typed-helper.js';
const typed: string[] = ["t1", "t2"];
const notIterable: unknown = 5;
console.log(forOfAll(typed, notIterable));
