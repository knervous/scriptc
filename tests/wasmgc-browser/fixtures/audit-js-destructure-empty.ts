// @native-only: the engine lane's JavaScript empty patterns do not throw on nullish sources (pre-existing)
// Empty object patterns in JavaScript over native dyn values throw V8's
// TypeError on a nullish source, top-level and nested.
import { jsEmpty, jsEmptyNested } from "./audit-js-destructure-empty-helper.js";
console.log([null, undefined, 0, {}].map(jsEmpty).join(" | "));
console.log([{}, { a: null }, { a: 1 }].map(jsEmptyNested).join(" | "));
