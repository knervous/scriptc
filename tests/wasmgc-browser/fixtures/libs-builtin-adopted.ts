// @native-only: the page builtins a module adopts (js.adoptBuiltin) are a native-dyn mechanism
import { run } from "./libs-builtin-adopted-helper.js";
console.log(run());
