// A callback passed to a JavaScript parameter that defaults to a no-op function returns its value: the void the checker
// infers from the default (`title = noop`) is not the parameter's contract, as Svelte's compiled snippets rely on.
import { run } from "./js-callback-noop-default-helper.js";
console.log(run());
