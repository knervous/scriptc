// @options: {"hostHandles": true}
// @native-only: compiled classes have no engine-dyn lowering
// @native-refuses: a compiled class cannot take newTarget's prototype before its constructor runs: Reflect.construct with a different newTarget throws instead of patching the prototype afterwards
// @expect-native: 1|1|TypeError: Reflect.construct with a different newTarget is not supported for this class yet
import { run } from "./reflect-construct-class-helper.js";
console.log(run());
