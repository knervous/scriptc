// `import("./m.js").then(({ C }) => C(...), onRejected)` in untyped code: the fulfillment handler destructures the
// module namespace (the deferred mesh builds of Babylon Lite), reading live exports by name.
// @ts-ignore: an untyped helper
import { count, labelOf, run } from "./then-namespace-destructure-helper.js";
run({ name: "s" }, [1, 2]).then((v) => { console.log(v); return count(); }).then((n) => { console.log("calls", n); return labelOf(); }).then((l) => console.log(l));
