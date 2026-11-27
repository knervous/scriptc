// @hits(native, native-any): \$forin\.read
// Prop-bag iteration reads the walked object's own data at the walk
// position while the object keeps the shape the walk started from; every
// change during the walk, own or inherited hasOwnProperty, other callees,
// accessors, bare and inherited prototypes keep JS's answers.
import { all, walk, copy } from "./js-forin-propbag-helper.js";
const page: any = globalThis;
console.log(all(page.auditMake2()));
// Objects from TypeScript (typed records under native-any) take the generic walk.
console.log(walk(copy({ a: 1, key: 2, b: null, c: "x" })));
