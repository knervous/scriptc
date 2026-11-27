// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { BIGINT_T, BOOL, DYN, F64, JSWORD, STRING } from "../ir.js";
import { defineLibFnSignatures } from "./shared.js";

/** The js builtin call slots. */
export const jsSignatures = defineLibFnSignatures({
  /* Dynamic-tier values (jsword; two-tier design stage S3). The jsword pass
   * (ir/jsword.ts) introduces these in dynamic-tier functions only; the
   * runtime is scr_js_value.c. Arguments are borrowed and results owned,
   * like every libCall. Boundary conversions: js.fromDyn (a cell keeps its
   * identity), js.toDyn (an immediate is boxed), js.fromF64/fromBool/
   * fromStr/fromBigInt (the design's toJs: immediates, and strings and
   * BigInts under a tag without a copy) and js.toF64 (fromJs to number: dynCheck's
   * number check and TypeError). The operators are the dyn.* operators
   * over jswords, with identical JS semantics. */
  "js.fromDyn": { argTypes: [DYN], result: JSWORD },
  "js.toDyn": { argTypes: [JSWORD], result: DYN },
  "js.fromF64": { argTypes: [F64], result: JSWORD },
  "js.fromBool": { argTypes: [BOOL], result: JSWORD },
  "js.fromStr": { argTypes: [STRING], result: JSWORD },
  "js.fromBigInt": { argTypes: [BIGINT_T], result: JSWORD },
  "js.toF64": { argTypes: [JSWORD], result: F64 },
  "js.add": { argTypes: [JSWORD, JSWORD], result: JSWORD },
  "js.arithmetic": { argTypes: [JSWORD, JSWORD, STRING], result: JSWORD },
  "js.bitwise": { argTypes: [JSWORD, JSWORD, STRING], result: JSWORD },
  "js.compare": { argTypes: [JSWORD, JSWORD, STRING], result: BOOL },
  "js.toNumeric": { argTypes: [JSWORD], result: JSWORD },
  "js.increment": { argTypes: [JSWORD, BOOL], result: JSWORD },
  "js.negate": { argTypes: [JSWORD], result: JSWORD },
  "js.toNumberCoerce": { argTypes: [JSWORD], result: F64 },
});
