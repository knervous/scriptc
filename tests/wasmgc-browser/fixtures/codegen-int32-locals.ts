// Int32 narrowing in JavaScript sources (see the helper).
import { lanes, setGlobals } from "./codegen-int32-locals-helper.js";
const fs: any[] = [{ lanes: 1, childLanes: 4, flags: 524288 | 2 }, { lanes: 2 ** 31, childLanes: -1, flags: 3 }, { lanes: NaN, childLanes: -0, flags: 2 ** 40 + 5 }, { lanes: "8", childLanes: { valueOf() { return 16; } }, flags: 1 }];
console.log(lanes(fs));
setGlobals();
console.log(lanes(fs));
console.log(lanes([]));
import { hoisted } from "./codegen-int32-locals-helper.js";
console.log(hoisted(true), hoisted(false));
