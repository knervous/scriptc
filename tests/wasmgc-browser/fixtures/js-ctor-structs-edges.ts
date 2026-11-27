// Constructor structs (experimentalJsConstructorStructs) at their edges: unrecognized bodies, prototype
// accessors before and during construction, throws midway, explicit returns, replaced prototypes,
// identity and mass conversion past the constructor's limit.
// @options: {"experimentalJsConstructorStructs":true}
// @native-only: experimentalJsConstructorStructs is a native-dyn compile option
// @hits(native,native-any): ^\$ctor\.\d+\.ok$
import { run, mass } from './js-ctor-structs-edges-helper.js';
console.log(run());
console.log(mass());
