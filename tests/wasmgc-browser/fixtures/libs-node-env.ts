// @native-only: process.env on the browser target is the page's own process.env (engine dyn has no lowering for it)
// process.env.NODE_ENV in library JS without a define: the page's environment (Node's, here).
import { mode } from "./libs-node-env-helper.js";
console.log(mode());
