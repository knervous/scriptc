// @native-only: engine dyn refuses a non-null object-literal prototype
// An untyped literal's __proto__ key sets its prototype (an object) or is ignored (a primitive).
import { run } from "./js-proto-literal-helper.js";
console.log(run());
