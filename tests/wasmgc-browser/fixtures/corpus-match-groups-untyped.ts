// @native-only: the engine model's match results reach untyped code without index, input or groups (a separate engine-model gap)
// A match/exec result stored in untyped code is the page's own match array:
// the compiled string[] slice has no index, input or groups, so reading
// them there was undefined. Corpus: 2611-regex-named-groups-js.
import { matches } from "./corpus-match-groups-untyped-helper.js";
console.log(matches());
