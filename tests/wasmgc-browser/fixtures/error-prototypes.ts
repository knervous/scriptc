// @options: {"hostHandles": true}
// @native-only: compiled error prototypes have no engine-dyn lowering (the engine lane keeps the page's)
import { run } from "./error-prototypes-helper.js";
console.log(run());
