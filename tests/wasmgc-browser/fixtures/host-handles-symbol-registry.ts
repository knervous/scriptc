// @options: {"hostHandles": true}
// Symbol.for / well-known symbols: the same key is the same symbol (stable identity), with
// constant and computed keys alike.
import { run } from "./host-handles-symbol-registry-helper.js";
console.log(run());
