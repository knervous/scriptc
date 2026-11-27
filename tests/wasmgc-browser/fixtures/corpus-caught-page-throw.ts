// A value the page throws enters dyn as any page value would: a compiled
// object it throws back (through its facade) is itself again, a number a
// number. Corpus: js-abort-portable ("throw true").
import { caughtIdentity } from "./corpus-caught-page-throw-helper.js";
console.log(caughtIdentity());
