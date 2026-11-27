// @hits(native,native-any): \$once\.\$symfor
// Symbol.for(<constant>) in untyped code is fetched once per key and is the
// page's registered symbol (identity across sites, modules and computed keys).
import { probe, sentinel, check } from "./js-symbol-for-once-helper.js";
console.log(probe());
console.log(check(sentinel()), check(Symbol.for("app.memo_sentinel")), check(Symbol.for("app.other")));
