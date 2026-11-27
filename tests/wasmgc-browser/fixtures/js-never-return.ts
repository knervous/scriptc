// Untyped functions whose inferred return type is never (a `never[]`
// element) return their value instead of dropping it.
import { run } from "./js-never-return-helper.js";
console.log(run());
