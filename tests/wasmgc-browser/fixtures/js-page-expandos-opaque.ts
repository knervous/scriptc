// @native-only: experimentalOpaquePageExpandos is a native-model compile option
// @options: {"experimentalOpaquePageExpandos": true}
// @profile: experimentalOpaquePageExpandos stores compiled objects, arrays and typed records on page objects opaquely: the page reads an object with no properties, distinct from the value's facade
// @hits(native,native-any): ^\$dyn\.pageSet$
// @hits(native,native-any): ^\$page\.delete5$
// @hits(native,native-any): ^\$dyn\.pageGetUnwrap$
// @expect: frozen true
// @expect: true true true object,true,,,false,true,true true 6 false true true object,true,7,tag,false,true,true true 2 true true 5 false false false id true false
// @expect: true object,true,,,false,true,true true typed
import { run, runTyped } from "./js-page-expandos-opaque-helper.js";
console.log(run(globalThis));
interface Props { title: string; count: number }
const props: Props = { title: "typed", count: 3 };
console.log(runTyped(globalThis, props));
