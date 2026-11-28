// A JSDoc cast to a type parameter instantiated as void is no check: the void call's value is discarded.
import { run } from "./js-generic-void-cast-helper.js";
console.log(run());
