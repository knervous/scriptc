// Inherited builtin members of untyped values, read as values (not called)
// and through `in`: they are the page's own members, not undefined.
import { make, probe } from "./js-inherited-members-helper.js";
console.log(probe(make()));
