// @options: {"hostHandles": true}
// @native-only: compiled error constructors have no engine-dyn lowering (the engine lane keeps the page's)
import { run } from "./error-ctor-values-helper.js";
console.log(run());
