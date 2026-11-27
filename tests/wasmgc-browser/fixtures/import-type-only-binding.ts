// @profile: the browser target follows the page's bundler (esbuild/Vite, isolatedModules), which erases a named import whose binding is only a type; Node's type stripping keeps it and fails to link with a SyntaxError
// @expect: 3 7
// A plain `import { Events }` of a type-only export, used only in types, links and runs (game/Events/event-hooks.ts).
import { Events, VERSION } from "./import-type-only-binding-helper.ts";
const sample: Events["ping"] = 7;
console.log(VERSION, sample);
