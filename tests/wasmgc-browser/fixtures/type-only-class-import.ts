// A class reached only through `import type` still types signatures (a
// function-typed slot, a nullable field), and its module never evaluates:
// Node elides a type-only import, so the helper's top-level log must not run.
import type { Box } from "./type-only-class-import-lib/box";
let measure: ((b: Box) => number) | null = null;
class Holder { box: Box | null = null; }
const h = new Holder();
console.log(measure === null, h.box === null);
measure = (b) => b.twice();
console.log(typeof measure);
