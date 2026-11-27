/* The fences a WasmGC build compiled as runtime errors, as the release gate and the fence receipt read them
 * (index.ts emitWasmGcArtifacts). */
import type { IrModule, SrcLoc } from "./ir/ir.js";

/** Fences that are not unsupported operations but traps on paths proven never to run (an `unreachable` that reports a
 * compiler bug if it ever does): SC9002 after a non-void body whose every path the checker proved returns, SC9003 for
 * a virtual call whose receiver no instance can be (unimplemented-virtual.ts). A release build admits them. */
export const PROVEN_UNREACHABLE_TRAPS = new Set(["SC9002", "SC9003"]);

export type CompiledFence = { code: string; message: string; loc: SrcLoc };

/** Every unsupported-operation fence the module's functions compiled as a runtime error instead of code, in either
 * form the lowering leaves one: a `runtimeFence` statement, or an SC-coded `error.nodeThrow` a deferred fence compiled
 * into an expression (a short-circuit operand's, a fenced closure's or member read's, a derived constructor's
 * repeated-super() guard). The release gate refuses exactly this list and the fence receipt reports it, so the two
 * cannot disagree about a fence because of its form. Proven-unreachable traps (PROVEN_UNREACHABLE_TRAPS) are left out
 * of both. A fence with no span of its own takes its function's (else the module's file), so none passes unreported.
 * Statement fences come first, then expression fences, each in walk order (the receipt's order before they shared). */
export function collectFences(mod: IrModule): CompiledFence[] {
  const statements: CompiledFence[] = [], expressions: CompiledFence[] = [];
  const seen = new Set<string>();
  const add = (to: CompiledFence[], code: string, message: string, loc: SrcLoc): void => {
    if (PROVEN_UNREACHABLE_TRAPS.has(code)) return;
    // The message too: fences in synthesized helpers can share one span (a dispatcher's), and each must be listed.
    const key = `${loc.file}:${loc.start}:${code}:${message}`;
    if (!seen.has(key)) { seen.add(key); to.push({ code, message, loc }); }
  };
  const visit = (n: unknown, around: SrcLoc): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x, around); return; }
    const node = n as { kind?: string; code?: string; message?: string; fn?: string; args?: { value?: unknown }[]; loc?: SrcLoc };
    if (node.kind === "runtimeFence") add(statements, node.code ?? "", node.message ?? "", node.loc ?? around);
    else if (node.kind === "libCall" && node.fn === "error.nodeThrow") {
      const code = node.args?.[1]?.value, message = node.args?.[2]?.value;
      if (typeof code === "string" && /^SC\d+$/.test(code)) add(expressions, code, typeof message === "string" ? message : "", node.loc ?? around);
    }
    for (const v of Object.values(n)) if (v && typeof v === "object") visit(v, around);
  };
  const moduleLoc: SrcLoc = { file: mod.sourceFile, start: 0, end: 0 };
  for (const f of mod.functions) visit(f.body, f.loc ?? moduleLoc);
  return [...statements, ...expressions];
}
