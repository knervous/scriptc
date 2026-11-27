// @options: {"hostHandles": true}
// @native-only: no engine-dyn lowering for this member (the engine lane keeps the page's)
// @native-refuses: Error.prepareStackTrace has no V8 stack API natively: a read is undefined and a write is accepted and ignored (the page keeps its property on the web host)
// @expect-native: undefined
import { run } from "./error-prepare-stack-trace-helper.js";
console.log(run());
