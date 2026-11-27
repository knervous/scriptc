// Constant-key reads of String.prototype members on a dyn string resolve them
// (the computed read: js-string-computed-key).
import { members, ctor } from "./js-string-constant-member-helper.js";
console.log(members(" abc"));
console.log(ctor(" abc"));
