// @native-only: the engine lane fences this the same way; the directive below judges the native lanes
// @native-refuses: an async generator declared inside a function body of untyped code has no lowering yet: it compiles (it once crashed the compiler with an invalid module) and fences uncaught when called
// @expect-native: before
// @expect-native-fence: _g yet [SC3002
console.log("before");
import { run } from './fence-async-generator-local-helper.js';
console.log(run());
