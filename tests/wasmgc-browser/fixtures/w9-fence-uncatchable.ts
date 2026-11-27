// @native-only: the engine lane fences this the same way; the directive below judges the native lanes
// @native-refuses: a class declared inside a function body of untyped code and used as a value has no native lowering (SC3002): the fence must reach the top level, not the program's catch
// @expect-native: before
// @expect-native-fence: function-local class as a value yet [SC3002
// Regression (a9083d09): 3001-caught-typeof-object.js printed a caught fence as an ordinary TypeError.
console.log("before");
import { run } from './w9-fence-uncatchable-helper.js';
console.log(run());
