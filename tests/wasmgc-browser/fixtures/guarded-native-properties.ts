// @native-only: mixed class/property facade coverage traps in engine dyn (recorded by the guarded-specialization proof; engine class facades are incomplete)
import {observations} from './guarded-native-properties-helper.js';
const page: any = globalThis;
console.log(observations(page));
