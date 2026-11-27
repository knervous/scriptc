// console.log of untyped values in native dyn: objects, arrays, nesting, cycles,
// null prototypes, hidden properties, functions, typed records and arrays.
import { consoleValues } from './r6-accessor-helper.js';
const typed: { n: number; tags: string[] } = { n: 1, tags: ["a"] };
const list: number[] = [1, 2, 3];
consoleValues(typed, list);
