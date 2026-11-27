// new ArrayBuffer(n) in a JS source on the browser target: the page's ArrayBuffer (lodash _getTag.js: new DataView(new ArrayBuffer(1)) at module init).
import { run } from "./libs-array-buffer-helper.js";
console.log(run());
