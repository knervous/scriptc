// Re-exporting a module's re-exports of its own imports: a default-import binding and a namespace binding exported
// under new names by one module and passed on by another (React's index -> ReactClient -> shared internals). Same
// output as Node.
import { __INTERNALS, __RUNTIME, bump } from "./esm-alias-reexport-lib/index.ts";
bump();
bump();
console.log(__INTERNALS.count, __RUNTIME.tag);
