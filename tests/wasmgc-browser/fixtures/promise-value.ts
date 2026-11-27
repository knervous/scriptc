// @options: {"hostHandles": true}
// @native-only: Promise as a compiled constructor value has no engine-dyn lowering (the engine lane keeps the page's)
// @native-any-only: the untyped Promise binding is TS any (the plain native lane keeps the page's)
import { run } from "./promise-value-helper.js";
run().then((s: string) => console.log(s));
