// The global-object probe: Function("return this")() is the page's globalThis (lodash _root.js: freeGlobal || freeSelf || Function("return this")()).
import { run } from "./libs-short-circuit-fence-helper.js";
console.log(run());
