// @options: {"hostHandles": true}
// @native-only: the compiled Promise.prototype has no engine-dyn lowering (the engine lane keeps the page's)
// @native-any-only: the untyped Promise binding is TS any (the plain native lane keeps the page's)
import { run } from "./promise-prototype-helper.js";
run().then((s: string) => console.log(s));
