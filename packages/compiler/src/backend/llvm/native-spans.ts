/* The FFI span classes a WasmGC link spells against its one shared memory, on a native link (the LLVM lane):
 *
 * - shared-bytes returns: the callee answers a span of memory it owns, read in place. A wasm callee packs it in an i64
 *   as (length << 32) | address; a native address does not fit, so a native callee exports a twin
 *   `<symbol>_native(params..., uint64_t *length) -> const uint8_t *` (FFI classes `pointer` and `u64`): the data
 *   pointer, NULL for none, and the length through the trailing out-parameter (0 for none). The caller reads it as a
 *   non-owning Uint8Array view (scr_bytes_from_external) under the callee's lifetime contract, exactly the wasm view.
 * - retained-bytes arguments: a span the callee keeps past the call (a worker ring). Natively the array's storage is
 *   pinned by a count that is never dropped, then it crosses as (pointer, length) like `bytes`. */
import type { LlvmEmitterContext, LlValue } from "./expr-context.js";
import type { IrType } from "../../ir/ir.js";

/** The native twin a shared-bytes return calls. */
export function sharedBytesNativeSymbol(symbol: string): string {
  return `${symbol}_native`;
}

/** Calls `<symbol>_native` with the lowered arguments plus the length out-parameter; answers the owned view. */
export function emitSharedBytesCall(host: LlvmEmitterContext, symbol: string, paramTypes: string[], args: string[], type: IrType): LlValue {
  const B = host.B;
  const native = sharedBytesNativeSymbol(symbol);
  const lenSlot = B.slot();
  B.entryAllocas.push(`${lenSlot} = alloca i64`);
  B.line(`store i64 0, ptr ${lenSlot}`);
  host.declare(`declare ptr @${native}(${[...paramTypes, "ptr"].join(", ")})`);
  const data = B.tmp();
  B.line(`${data} = call ptr @${native}(${[...args, `ptr ${lenSlot}`].join(", ")})`);
  const len = B.tmp();
  B.line(`${len} = load i64, ptr ${lenSlot}`);
  host.declare(`declare ptr @scr_bytes_from_external(ptr, i64)`);
  const view = B.tmp();
  B.line(`${view} = call ptr @scr_bytes_from_external(ptr ${data}, i64 ${len})`);
  return host.own({ name: view, type });
}

/** Pins a retained-bytes argument's array for the program's life (the callee keeps its storage). */
export function emitRetainedBytesPin(host: LlvmEmitterContext, bytes: string): void {
  host.declare(`declare ptr @scr_bytes_retain_v(ptr)`);
  host.B.line(`${host.B.tmp()} = call ptr @scr_bytes_retain_v(ptr ${bytes}) ; pinned: never released`);
}
