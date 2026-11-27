// Constructor caches stay correct when a callee converts the object.
import { probe } from "./js-ctor-cache-across-call-helper.js";
console.log(probe());
