// Page values of every kind entering compiled untyped code: undefined, null,
// booleans, i31 and heap numbers (-0, NaN, the reserved NaN pattern, large
// integers), numeric-looking strings, symbols, bigints, page objects and
// functions, our own wrappers. Property reads and method results arrive
// pre-classified ($dyn.fromJsD; heap numbers boxed by dynFromNum), and so do
// a page call's this and first four arguments (dynCallFromJs@d).
// @hits(native,native-any): ^\$dyn\.fromJsD$
// @hits(native,native-any): ^\$dyn\.fromNumExport$
// @hits(native,native-any): ^\$dyn\.callFromJs$
import { readsAndCalls, thisAndArguments, equalities, roundTrips } from './host-value-classify-helper.js';
const page: any = globalThis;
console.log(readsAndCalls(page));
console.log(thisAndArguments(page));
console.log(equalities(page));
console.log(roundTrips(page));
