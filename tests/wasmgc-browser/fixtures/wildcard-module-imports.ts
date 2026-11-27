// @profile: bundler wildcard-module imports (Node has no ?pagemod; the expected output is the bundler's: each specifier is its own module)
// @expect: alpha beta
// @expect: false
// @expect: alpha
// Two imports through one wildcard ambient module are two modules: each binding reads its own page module, though the
// checker resolves both to the pattern's one declared export (Vite's `?worker` and `?url` imports have this shape).
/// <reference path="./wildcard-module-imports-env.d.ts" />
import alpha from "./alpha.txt?pagemod";
import beta from "./beta.txt?pagemod";
console.log(alpha, beta);
console.log(alpha === beta);
const read = (): string => alpha;
console.log(read());
