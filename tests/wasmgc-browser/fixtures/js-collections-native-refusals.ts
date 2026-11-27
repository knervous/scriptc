// @native-refuses: a compiled Map/Set becomes the page's collection on its first crossing, which is refused during its own forEach (JSON.stringify of it inside its forEach)
// @expect-native: TypeError: a compiled Map crossing to the page during its own forEach is not supported yet
// @expect-native: ok 6
// Map and Set operations the native collections refuse explicitly; the
// engine lane (the page's own Map) matches Node.
import { refusals } from "./js-collections-native-refusals-helper.js";
console.log(refusals());
