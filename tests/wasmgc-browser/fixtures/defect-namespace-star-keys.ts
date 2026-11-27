// @known-defect(engine, native, native-any): Object.keys of a namespace that re-exports with `export *` lists only its named exports (halve, mix, plus), not the star exports
// @known-defect-expect: stdout: halve,mix,plus
import * as relay from "./abi-module-ns-lib/relay.ts";
console.log(Object.keys(relay).sort().join(","));
