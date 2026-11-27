// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { bytesOf, DYN, F64, STRING, BOOL } from "../ir.js";
import { defineLibFnSignatures } from "./shared.js";

/** The atomics builtin call slots. */
export const atomicsSignatures = defineLibFnSignatures({
  "atomics.wait": { argTypes: [bytesOf("i32"), F64, F64, F64], result: STRING },
  // notify(arr, index[, count]): variadic (the count defaults to +Infinity).
  "atomics.notify": { argTypes: [bytesOf("i32"), F64], result: F64 },
  "atomics.op": { argTypes: [null, F64, F64, F64, F64], result: F64 },
  "atomics.opDyn": { argTypes: [DYN, F64, F64, F64, F64], result: F64 },
  "atomics.waitDyn": { argTypes: [DYN, F64, F64, F64], result: STRING },
  "atomics.notifyDyn": { argTypes: [DYN, F64, F64], result: F64 },
// Browser: the integer-typed-array Atomics surface (wasm atomic instructions;
// the element kind is program-dependent, checked by the frontend).
"atomics.load": { argTypes: [null, F64], result: F64 },
"atomics.store": { argTypes: [null, F64, F64], result: F64 },
"atomics.add": { argTypes: [null, F64, F64], result: F64 },
"atomics.sub": { argTypes: [null, F64, F64], result: F64 },
"atomics.and": { argTypes: [null, F64, F64], result: F64 },
"atomics.or": { argTypes: [null, F64, F64], result: F64 },
"atomics.xor": { argTypes: [null, F64, F64], result: F64 },
"atomics.exchange": { argTypes: [null, F64, F64], result: F64 },
"atomics.compareExchange": { argTypes: [null, F64, F64, F64], result: F64 },
// LLVM lane: the element size's lock-freedom (1, 2, 4 and 8 are).
"atomics.isLockFree": { argTypes: [F64], result: BOOL },
"atomics.waitAsyncStart": { argTypes: [bytesOf("i32"), F64, F64, F64], result: F64 },
"atomics.waitAsyncPromise": { argTypes: [], result: { kind: "promise", inner: STRING } },
"atomics.waitAsyncResult": { argTypes: [], result: STRING },
});
