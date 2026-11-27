// Stdlib constructors read as values in a JS source are the page constructors globalThis answers (lodash getNative).
import { run } from "./libs-global-ctor-identity-helper.js";
console.log(run());
