// @options: {"hostHandles": true}
// @native-only: the compiled builtin constructor values have no engine-dyn lowering (the engine lane keeps the page's)
// @native-any-only: the untyped Promise binding is TS any (the plain native lane keeps the page's)
import { run } from "./instanceof-builtin-values-helper.js";
console.log(run());
