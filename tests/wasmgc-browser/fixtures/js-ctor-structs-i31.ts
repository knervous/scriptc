// @options: {"experimentalJsConstructorStructs":true,"experimentalDynI31":true}
// @native-any-only: experimentalJsConstructorStructs and experimentalDynI31 are native-dyn compile options; the helper applies | to untyped values, which the native lane refuses
// Constructor struct i32 fields fed by i31 small integers and every other kind of number.
// @hits(native-any): ^\$ctor\.\d+\.new$
import { fields } from './js-ctor-structs-i31-helper.js';
console.log(fields(2));
