// @native-only: compiled errors' page forms carry their cause; the engine lane's errors are the page's
// @native-any-only: identity of a compiled error through the page needs the untyped route
// A compiled error's cause is an own, non-enumerable data property of its page form too; page-made errors carry theirs through compiled code.
import { run } from "./error-cause-web-helper.js";
console.log(run());
