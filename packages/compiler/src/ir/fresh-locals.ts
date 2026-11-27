import type { IrExpr, IrLocal, IrStmt } from "./ir.js";
import { everyStmtList, transformStmt } from "./traverse.js";

/** A copy of `region` (statements of a function whose whole body is `body`) in which every local the region declares
 * and nothing outside it references takes a fresh id: copies of one region behind different tests then hold their
 * temporaries in locals of their own, and the backend types each from its own copy's writes (an index temporary is an
 * i32 in the copy whose guard bounds it, whatever another copy stores). Every node of the copy is a distinct object
 * (the backend keys facts by node identity). A region outside `body` is copied with its ids. Regions holding closures, class values or try statements are the
 * callers' to refuse: their captures and catch bindings name locals outside `localId` fields. */
export function copyWithFreshLocals(
  body: readonly IrStmt[],
  region: readonly IrStmt[],
  locals: ReadonlyMap<string, IrLocal>,
  used: Set<string>,
  suffix: string,
): { copy: IrStmt[]; added: IrLocal[]; renames: ReadonlyMap<string, string> } {
  const declared = new Set<string>();
  everyStmtList([...region], { expr: () => true, stmt: (s) => { if (s.kind === "varDecl") declared.add(s.localId); return true; } });
  const inside = new Set<object>();
  everyStmtList([...region], { expr: (e) => (inside.add(e), true), stmt: (s) => (inside.add(s), true) });
  const outside = new Set<string>();
  const note = (n: IrExpr | IrStmt): boolean => {
    const id = (n as { localId?: unknown }).localId;
    if (!inside.has(n) && typeof id === "string" && declared.has(id)) outside.add(id);
    return true;
  };
  let found = false;
  everyStmtList([...body], { expr: note, stmt: (n) => (found ||= inside.has(n), note(n)) });
  const renames = new Map<string, string>(), added: IrLocal[] = [];
  // A region that is not part of `body` (a statement of an earlier copy) keeps its ids: the references around it are
  // not in view.
  if (found) for (const id of declared) {
    const local = locals.get(id);
    if (outside.has(id) || local === undefined) continue;
    let fresh = `${id}${suffix}`, n = 0;
    while (used.has(fresh)) fresh = `${id}${suffix}${++n}`;
    used.add(fresh);
    added.push({ ...local, id: fresh });
    renames.set(id, fresh);
  }
  const renamed = <T extends IrExpr | IrStmt>(n: T): T => {
    const id = (n as { localId?: unknown }).localId;
    return (typeof id === "string" && renames.has(id) ? { ...n, localId: renames.get(id)! } : { ...n }) as T;
  };
  return { copy: region.map((s) => transformStmt(s, { expr: renamed, stmt: renamed })), added, renames };
}
