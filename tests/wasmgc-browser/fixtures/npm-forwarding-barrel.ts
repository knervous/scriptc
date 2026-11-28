// @options: {"npmStatic": ["fwdbarrel"]}
// A package barrel that imports names only to export them (`import { a } from "./a.js"; export { a }`) forwards them as
// re-exports do: with `sideEffects: false`, the modules no importer asks for (one with a body a release build refuses,
// one behind a guarded `import("node:fs")`) are not compiled.
import { run } from "./npm-forwarding-barrel-lib/entry.ts";
run();
