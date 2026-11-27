// Numeric webs over reused untyped locals (see the helper).
import { memo, loops, lanes } from "./codegen-numeric-webs-helper.js";
console.log(memo({ alternate: null }, 4));
console.log(memo({ alternate: { updateQueue: { cache: [["a"]] } } }, 4));
console.log(memo({ alternate: { updateQueue: null } }, 0));
console.log(loops([1, 2, 3]));
console.log(loops(["skip", 1, "stop", 4]));
console.log(loops([]));
console.log(lanes({ pendingLanes: 6, suspendedLanes: 2, pingedLanes: 0, warmLanes: 0 }, 0), lanes({ pendingLanes: 0 }, 1), lanes({ pendingLanes: 268435456, suspendedLanes: 268435456, pingedLanes: 0, warmLanes: 0 }, 0), lanes({ pendingLanes: 40, suspendedLanes: 0, pingedLanes: 0, warmLanes: 8 }, 32));
import { params, withArguments, captured, mixed } from "./codegen-numeric-webs-helper.js";
console.log(params("p", 3, "s"), params(null, 0, 1));
console.log(withArguments("w", 2), withArguments(undefined, undefined));
console.log(captured([1]), captured(null));
console.log(mixed({ start: {}, v: { valueOf() { return 41; } } }), mixed({ start: "7", v: 0.5 }));
