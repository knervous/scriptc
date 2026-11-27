// @options: {"experimentalDynI31": true}
// @native-any-only: experimentalDynI31 is a native dyn representation; the helper leans on untyped values (JSON of any[], any-typed callbacks) the native lane does not compile
// Small integers as i31refs in native dyn: every boundary must read exactly
// as boxed numbers do (see the helper). The fast paths must be taken.
// @hits(native-any): ^\$(hit\.)?i31\.add$
// @hits(native-any): ^\$box\.i32\.recent$
// @hits(native-any): ^\$dyn\.strictEq\.num\.cold$
import { edges, page } from './dyn-i31-numbers-helper.js';
const g: any = globalThis;
console.log(edges(2));
console.log(page(2, g.Map, g.Array, g.JSON));
