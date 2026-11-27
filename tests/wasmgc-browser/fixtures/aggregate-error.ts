// @options: {"hostHandles": true}
// @native-only: the compiled AggregateError has no engine-dyn lowering (the engine lane keeps the page's)
// @native-any-only: the untyped Promise binding is TS any (the plain native lane keeps the page's)
import { run } from "./aggregate-error-helper.js";
run().then((s: string) => console.log(s));
