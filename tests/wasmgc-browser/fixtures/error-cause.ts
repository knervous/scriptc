// @options: {"hostHandles": true}
// @native-only: compiled error constructor values have no engine-dyn lowering (the engine lane keeps the page's)
import { run } from "./error-cause-helper.js";
console.log(run());
