/* Typed host modules (HOST_IMPORT_ABI §7) on the LLVM lane: `host.call(module, name, ...args)` — a function imported
 * from an ambient `declare module "host:fetch"` — is one call into the embedding host through the island ABI
 * (scr_host_module_call over the host island's vtable). Arguments cross as island values (numbers, booleans, strings,
 * page objects, a Uint8Array as a copy); the result converts to the declared type exactly as an island value would
 * (the validated exits), and a Promise result bridges into a scriptc promise settled on the program's event loop. */
import { InternalCompilerError } from "../../errors.js";
import { JSVAL, type IrExpr, type IrType } from "../../ir/ir.js";
import type { LlvmEmitterContext, LibCallExpr, LlValue } from "./expr-context.js";

/** The promise payload tags of scr_jsval_bridge_promise (SCR_ISLP_*) for the results a host module can declare. */
const PAYLOAD: Partial<Record<IrType["kind"], number>> = { void: 0, f64: 1, bool: 2, string: 3, jsval: 4 };

export function emitHostModuleCall(host: LlvmEmitterContext, e: LibCallExpr): LlValue {
  const B = host.B;
  const [moduleArg, nameArg, ...operands] = e.args;
  if (moduleArg?.kind !== "strLit" || nameArg?.kind !== "strLit") throw new InternalCompilerError("llvm emitter bug: host.call without its module and name literals");
  const where = `${moduleArg.value}.${nameArg.value}`;
  // Any other result type is the island value converted as the frontend's declared type says (the jsExit rules).
  if (e.type.kind !== "jsval" && e.type.kind !== "void" && e.type.kind !== "promise") {
    return host.emitExpr({ kind: "jsExit", value: { ...e, type: JSVAL }, type: e.type, loc: e.loc });
  }
  const values = operands.map((a): LlValue => {
    if (a.type.kind === "jsval") return host.emitExpr(a);
    if (a.type.kind !== "f64" && a.type.kind !== "bool" && a.type.kind !== "string" && !(a.type.kind === "bytes" && a.type.elem === "u8")) {
      throw new InternalCompilerError(`llvm emitter bug: host call ${where} with an argument of type ${a.type.kind}`);
    }
    const marshal: IrExpr = { kind: "jsMarshal", value: a, type: JSVAL, loc: a.loc };
    return host.emitExpr(marshal);
  });
  let pack = "null";
  if (values.length > 0) {
    pack = B.slot();
    B.entryAllocas.push(`${pack} = alloca [${values.length} x ptr]`);
    values.forEach((v, i) => {
      const p = B.tmp();
      B.line(`${p} = getelementptr inbounds [${values.length} x ptr], ptr ${pack}, i64 0, i64 ${i}`);
      B.line(`store ptr ${v.name}, ptr ${p}`);
    });
  }
  host.declare(`declare ptr @scr_host_module_call(ptr, ptr, i32, ptr)`);
  const raw = B.tmp();
  B.line(`${raw} = call ptr @scr_host_module_call(ptr ${host.internLiteral(moduleArg.value)}, ptr ${host.internLiteral(nameArg.value)}, i32 ${values.length}, ptr ${pack})`);
  // The result joins its frame before the pending check, so an unwind releases the NULL dummy harmlessly.
  const result = host.own({ name: raw, type: JSVAL });
  host.emitPendingCheck();
  if (e.type.kind === "jsval") return result;
  if (e.type.kind === "void") return { name: "", type: e.type };
  const tag = PAYLOAD[e.type.inner.kind];
  if (tag === undefined) throw new InternalCompilerError(`llvm emitter bug: host call ${where} answering a Promise of ${e.type.inner.kind}`);
  host.declare(`declare ptr @scr_jsval_bridge_promise(ptr, i32)`);
  const p = B.tmp();
  B.line(`${p} = call ptr @scr_jsval_bridge_promise(ptr ${raw}, i32 ${tag})`);
  const out = host.own({ name: p, type: e.type });
  host.emitPendingCheck();
  return out;
}
