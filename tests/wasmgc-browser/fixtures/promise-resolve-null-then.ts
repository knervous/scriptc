// @options: {"hostHandles": true}
// @native-only: the compiled Promise value (the engine lane keeps the page's)
import { run } from "./promise-resolve-null-then-helper.js";
run().then((s: string) => console.log(s));
