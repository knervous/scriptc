// @options: {"define": {"process.env.NODE_ENV": "\"production\""}}
// @profile: the bundler-style define replaces process.env.NODE_ENV with "production" (Node's environment has none)
// @expect: production
import { mode } from "./libs-node-env-helper.js";
console.log(mode());
