import { expect, test } from "vitest";
import { emitWasmGcModule } from "./emitter.js";
import { F64, VOID, type IrModule } from "../../ir/ir.js";
const loc = { file: "pure.ts", start: 0, end: 1 };
test("native-any elides only proven unused scalar calls and evaluates arguments", () => {
  const mod: IrModule = { irVersion: 17, sourceFile: loc.file, entry: "main", globals: [{ id: "count", name: "count", type: F64, mutable: true }], functions: [
    { name: "pure", loc, params: [{ localId: "x", name: "x", type: F64 }], locals: [{ id: "x", name: "x", type: F64, mutable: false }], returnType: F64, body: [{ kind: "return", value: { kind: "varRef", localId: "x", type: F64, loc }, loc }] },
    { name: "main", loc, params: [], locals: [], returnType: VOID, body: [{ kind: "exprStmt", expr: { kind: "call", callee: "pure", args: [{ kind: "incDec", localId: "count", op: "+", prefix: true, type: F64, loc }], type: F64, loc }, loc }] },
  ] };
  const normal = emitWasmGcModule(mod, { browser: true, text: true });
  const candidate = emitWasmGcModule(mod, { browser: true, experimentalTsNativeAny: true, text: true });
  expect(candidate.pureCallElisions).toBe(1);
  expect(normal.text).toContain('(call $pure');
  expect(candidate.text).not.toContain('(call $pure');
  expect(candidate.text).toContain('(global.set');
});
