// @options: {"hostHandles": true}
// @native-only: the untyped operands are compiled dyn values in the native lanes
import { run } from "./host-handles-island-ops-helper.js";
console.log(run());
