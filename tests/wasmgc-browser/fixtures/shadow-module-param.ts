// @native-any-only: an npm-static bundle whose inlined helper wrappers take `module` as a parameter (`function (module) { module.exports = helper }`)
// must keep its real `exports.name = value` surface: the shadowing parameters are respelled before the checker reads the file.
// @options: {"npmStatic": ["shadowmod"]}
import { run } from "./shadow-module-lib/entry.ts";
run();
