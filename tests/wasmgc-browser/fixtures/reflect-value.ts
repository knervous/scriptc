// @options: {"hostHandles": true}
// @native-only: Reflect as a compiled object has no engine-dyn lowering (the engine lane keeps the page's)
import { run } from "./reflect-value-helper.js";
console.log(run());
