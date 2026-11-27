// Untyped switch over ten string labels: strings dispatch by length; other kinds match nothing.
import { eventKind } from './r4-typed-helper.js';
const vals: unknown[] = ["click", "close", "copy", "cut", "dblclick", "keydown", "keyup", "10", 10, "", null, "clicks", { k: "click" }, undefined];
let out = "";
for (const v of vals) out += String(eventKind(v)) + ",";
console.log(out);
