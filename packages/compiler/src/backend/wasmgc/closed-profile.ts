import type { IrModule, IrType, SrcLoc } from "../../ir/ir.js";
import { everyStmtList } from "../../ir/traverse.js";

/** First closed admission slice: scalar entry ABI and compiler-owned fixed
 * records. It rejects unknown IR operations instead of guessing their effects.
 * This is a compilation contract, not a restricted host/security profile. */
export function checkClosedProfile(mod: IrModule, exports: readonly string[]) {
  const refusals: { message: string; loc?: SrcLoc }[] = [];
  const seen = new Set<string>(), shapes = new Map((mod.records ?? []).map(r => [r.id, r]));
  const refuse = (message: string, loc?: SrcLoc) => {
    const key = `${loc?.file}:${loc?.start}:${message}`;
    if (!seen.has(key)) { seen.add(key); refusals.push({ message: `closed profile: ${message}`, ...(loc ? {loc} : {}) }); }
  };
  const checkedShapes = new Set<string>();
  const checkType = (type: IrType, loc?: SrcLoc): void => {
    if (["void", "f64", "bool"].includes(type.kind)) return;
    if (type.kind === "record") {
      if (checkedShapes.has(type.shapeId)) return;
      checkedShapes.add(type.shapeId);
      const shape = shapes.get(type.shapeId);
      if (!shape || shape.indexValue || shape.tuple) { refuse(`record ${type.shapeId} is not a fixed-field record`, loc); return; }
      for (const field of shape.fields) checkType(field.type, loc);
      return;
    }
    refuse(`type ${type.kind} has no admitted representation in this slice`, loc);
  };
  if (mod.ffiImports?.length || mod.embedded?.modules.length) refuse("foreign imports and embedded JS are not admitted");
  for (const global of mod.globals ?? []) checkType(global.type, global.source?.loc);
  const expressions = new Set(["numLit", "boolLit", "varRef", "bin", "unary", "ternary", "call", "recordLit", "recordGet", "seqExpr"]);
  const statements = new Set(["varDecl", "assign", "return", "if", "while", "doWhile", "for", "block", "break", "continue", "exprStmt", "recordSet"]);
  const functions = new Map(mod.functions.map(f => [f.name, f]));
  for (const name of new Set([mod.entry, ...exports])) {
    const f = functions.get(name);
    if (!f) { refuse(`export ${name} is not a module function`); continue; }
    if (f.params.some(p => !["f64", "bool"].includes(p.type.kind)) || !["f64", "bool", "void"].includes(f.returnType.kind)) refuse(`export ${name} must use the scalar entry ABI`, f.loc);
  }
  for (const f of mod.functions) {
    checkType(f.returnType, f.loc);
    for (const p of f.params) checkType(p.type, f.loc);
    for (const local of f.locals) checkType(local.type, f.loc);
    if (f.async || f.captures?.length || f.generator) refuse(`function ${f.name} has an unsupported lifetime`, f.loc);
    everyStmtList(f.body, {
      expr: e => {
        checkType(e.type, e.loc);
        if (!expressions.has(e.kind)) refuse(`operation ${e.kind} is not admitted`, e.loc);
        if (e.kind === "call" && !functions.has(e.callee)) refuse(`call ${e.callee} leaves the closed module`, e.loc);
        if (e.kind === "recordLit" && e.fields.some(field => field.overflow || field.drop)) refuse("overflow record fields are not admitted", e.loc);
        return true;
      },
      stmt: s => { if (!statements.has(s.kind)) refuse(`operation ${s.kind} is not admitted`, s.loc); return true; },
    });
  }
  return { schema: "scriptc-closed-profile/1", profile: "owned-scalar-records/1", admitted: refusals.length === 0,
    entryAbi: "number/boolean scalars; records are private to the module", exports: [...exports],
    entries: exports.map(name => { const f = functions.get(name); return {name, params: f?.params.map(p => p.type.kind) ?? [], result: f?.returnType.kind ?? "missing"}; }),
    functions: mod.functions.map(f => f.name), records: [...checkedShapes], refusals };
}
