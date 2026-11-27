// @hits(native,native-any): dyn\.class\.index\.get$
// @hits(native,native-any): dyn\.class\.index\.set$
// Member writes with constant and number keys in untyped JS (helper).
import { obj, arr, bytes, floats, fiber, chains, detachPair, compound, update, logical, memoCache, holes, numberKeys, numericStrings, typed, accessors } from "./js-member-keys-helper.js";
console.log(fiber(5, "k"));
console.log(chains());
console.log(detachPair());
console.log(compound(obj(1), arr(1)));
console.log(update(obj(2), arr(2)));
console.log(logical(obj(3), arr(3)));
console.log(memoCache(4));
console.log(holes());
console.log(numberKeys(obj(0), "abc", 2));
console.log(numericStrings(arr(0)));
console.log(typed(bytes(), floats()));
console.log(accessors());
