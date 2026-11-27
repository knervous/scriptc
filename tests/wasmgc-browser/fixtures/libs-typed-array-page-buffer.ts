// @known-defect(engine): a compiled typed array cannot view a page ArrayBuffer (compiled typed arrays live in Wasm memory; an untyped buffer argument has no native lowering). Native and native-any compile the helper, whose local `new ArrayBuffer(n)` is compiled storage the views alias.
import { run } from "./libs-typed-array-page-buffer-helper.js";
console.log(run());
