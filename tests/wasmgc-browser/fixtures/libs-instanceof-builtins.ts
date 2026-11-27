// @native-only: instanceof builtin constructors on compiled values is a native-model test (engine dyn lacks dyn.nativeRegexIs)
import { run } from "./libs-instanceof-builtins-helper.js";
console.log(run());
