// An unused module-level export whose initialiser is pure is not evaluated (its closures are not compiled); a used one runs; an
// initialiser with an observable effect still runs even though nothing reads the binding.
import { USED, counter } from "./pure-init-lib/codecs.ts";
console.log(USED.name, USED.decode(41), counter);
