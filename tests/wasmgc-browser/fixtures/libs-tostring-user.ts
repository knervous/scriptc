// @native-only: toString as an ordinary method call is the native lane's lowering (engine dyn narrows dyn.toString to a string)
import { run } from "./libs-tostring-user-helper.js";
console.log(run());
