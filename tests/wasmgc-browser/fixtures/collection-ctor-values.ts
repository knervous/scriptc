// @options: {"hostHandles": true}
// @native-only: Symbol(...) keys and the compiled collections have no engine-dyn lowering (the engine lane keeps the page's)
// WeakMap / WeakSet and the collection constructors read as values are compiled (react-dom's CapturedStacks / PossiblyWeakMap).
// Compiled WeakMaps hold their keys strongly (WasmGC has no weak references): unobservable, but the keys stay alive with the map.
import { run } from "./collection-ctor-values-helper.js";
console.log(run());
