import state from "./state.ts";
import * as runtime from "./runtime.ts";
export function bump(): number { return ++state.count; }
// A default import and a namespace import re-exported under other names (React's ReactClient exports its shared
// internals this way).
export { state as __INTERNALS, runtime as __RUNTIME };
