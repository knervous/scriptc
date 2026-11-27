// A value the checker types `any` but that is a string at run time (an untyped event's filtered value): indexing it reads a character, or undefined out of range.
import { at, normalize } from "./any-string-index-helper.js";
console.log(normalize({ target: { value: "aLDRIC-9" } }), JSON.stringify(normalize({ target: { value: "--" } })));
console.log(at({ target: { value: "a-b-c" } }, 1), at({ target: { value: "ab" } }, 5) === undefined);
