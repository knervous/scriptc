// A bundler's output from npm packages (esbuild's `// node_modules/...` module markers) is vendored:
// its checker errors (names a feature probe guards with typeof) never gate the build.
import { run } from "./libs-vendored-bundle-helper.js";
console.log(run());
