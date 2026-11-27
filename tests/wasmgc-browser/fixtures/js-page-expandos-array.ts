// @known-defect(engine): a dyn array (Array(n)) stored on a page object does not read back as itself under engine dyn
// @hits(native,native-any): ^\$dyn\.setFacade\.1$
// @hits(native,native-any): ^\$dyn\.pageGetUnwrap$
import { run } from "./js-page-expandos-array-helper.js";
console.log(run(globalThis));
