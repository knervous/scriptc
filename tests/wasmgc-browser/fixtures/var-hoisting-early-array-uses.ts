// A promoted (read before its store) array var is usable everywhere a plain one is once stored.
import { before, probeEarly, report, after } from "./var-hoisting-early-array-uses-helper.js";
console.log(before, probeEarly);
console.log(report);
console.log(after);
