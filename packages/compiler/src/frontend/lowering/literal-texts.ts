// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
/** One string per text among the long string literals of a pass's lowered functions.
 *
 * Ported from upstream scriptc (caf26910d3). Lowering writes a failure message at every site that can fail: a
 * checked narrowing, a union conversion, a foreign element read. The message spells the types involved, so it is
 * long, it is built by concatenation, and a program has few distinct ones. Left alone, each site keeps its own
 * unflattened concatenation until something hashes it. Interned as each function is finished, a pass holds one
 * string per text. The emitted program is unchanged: only which string object an IR node points to differs. */
import type { IrFunction } from "../../ir/ir.js";
import { everyStmtList, type IrVisitor } from "../../ir/traverse.js";

/** A literal shorter than this is left as it is: short texts are cheap, and most are distinct. */
const MIN_LENGTH = 64;

export class LiteralTexts {
  private readonly texts = new Map<string, string>();
  /** How many functions of each growing list have been interned. */
  private readonly interned = new Map<readonly IrFunction[], number>();
  private readonly visitor: IrVisitor = {
    expr: (expr) => {
      if (expr.kind === "strLit" && expr.value.length >= MIN_LENGTH) {
        const known = this.texts.get(expr.value);
        if (known === undefined) this.texts.set(expr.value, expr.value);
        else expr.value = known;
      }
      return true;
    },
    stmt: () => true,
  };

  /** Interns the string literals of one finished function. */
  intern(fn: IrFunction): void {
    everyStmtList(fn.body, this.visitor);
  }

  /** Interns the functions appended to `list` since the last call with it. The lowerer also removes functions from
   * its lists (a header stub's closures) and replaces them in place: the count is clamped, and a function it skips
   * or visits twice only keeps its own string, so either is harmless. */
  internAdded(list: readonly IrFunction[]): void {
    let next = Math.min(this.interned.get(list) ?? 0, list.length);
    for (; next < list.length; next++) this.intern(list[next]!);
    this.interned.set(list, next);
  }
}
