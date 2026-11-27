// A rest function and an `arguments` function share one closure ABI (one
// hidden trailing argument array), but their dynamic-call adapters fill it
// differently (the surplus arguments, or every argument): they must not be
// shared, whichever is built first. Corpus: checked-rest-function-adapters.
import { adapters } from "./corpus-rest-arguments-adapters-helper.js";
console.log(adapters(true));
console.log(adapters(false));
