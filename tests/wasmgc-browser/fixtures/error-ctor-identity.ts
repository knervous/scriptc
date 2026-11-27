// @native-only: instanceof against the error constructors has no engine-dyn lowering (the engine lane keeps the page's)
// The error constructors read as values are the page's own on the web host (adopted at module start): identity both ways.
import { run } from "./error-ctor-identity-helper.js";
console.log(run());
