// @profile: the browser target follows the page, which has no `process` global (Vite defines none): typeof process is "undefined" and evaluating it throws its ReferenceError; Node has one
// @expect: undefined console:boom
// @expect: true process is not defined
import { callProcess, report } from "./browser-process-absent-helper.js";
console.log(typeof process, report("boom"));
console.log(callProcess());
