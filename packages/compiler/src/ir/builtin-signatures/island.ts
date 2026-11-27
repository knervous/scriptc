import { VOID, STRING, JSVAL } from "../ir.js";
import { defineLibFnSignatures } from "./shared.js";

/** The island builtin call slots. */
export const islandSignatures = defineLibFnSignatures({
"island.eval": { argTypes: [STRING], result: STRING },
/** Load an embedded npm package's runtime entry in the island (cached by
 * the engine's module registry) and take one export: args are the entry
 * KEY (an embedded module's key, from IrModule.embedded) and the export
 * name — "default" for default imports, "*" for the namespace object.
 * --dynamic only, like island.eval; result is an owned jsval. May throw
 * (a package's top-level code can), bridged catchably. */
"island.import": { argTypes: [STRING, STRING, STRING], result: JSVAL },
/** Dynamic `import(spec)`: load a module through the island's module
 * system — an embedded module's key or a builtin shim's "node:x" key —
 * and answer an ENGINE promise of its namespace object (always a
 * promise, never a throw: load and evaluation failures REJECT it,
 * Node's shape). The frontend wraps the result in jsBridgePromise, so
 * awaiting parks the fiber and a rejection crosses catchably. --dynamic
 * only; result is an owned jsval holding the engine promise. */
"island.importDyn": { argTypes: [STRING], result: JSVAL },
// Result is the cast's mapped PROMISE target (program-dependent) —
// checked in the libCall case, like error.new.
/** A checked cast the boundary can never satisfy, DEFERRED to runtime:
 * `islandValue as Promise<T>` — the value is an ENGINE promise and T
 * has no validated exit (Node-typed async APIs put class-shaped
 * interfaces there), so instead of refusing the build the cast throws a
 * catchable TypeError AT THE CAST naming the target type (args: the
 * island value — evaluated, borrowed — and the type name). The result
 * type is the cast's mapped target (a typed dummy; the exception is
 * pending). Documented divergence: JS `as` never checks — like the dyn
 * boundary, a conversion that cannot happen throws instead of lying.
 * --dynamic only. */
"island.castFail": { argTypes: [JSVAL, STRING], result: VOID },
});
