// JSON.stringify with replacer functions/arrays, indentation, toJSON, and typed values.
import { jsonForms } from './r6-accessor-helper.js';
const typed: { n: number; tags: string[] } = { n: 2, tags: ["p", "q"] };
console.log(jsonForms(typed));
const viaTs: string = JSON.stringify(typed, (k: string, v: unknown) => (k === "n" ? 99 : v));
console.log(viaTs);
