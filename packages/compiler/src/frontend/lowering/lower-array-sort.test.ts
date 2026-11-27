import { expect, test } from "vitest";
import { STRING, type IrStmt, type SrcLoc } from "../../ir/ir.js";
import { buildArraySortFn } from "./lower-array-sort.js";

const loc: SrcLoc = { file: "sort.ts", start: 0, end: 1 };

/** Each ref-counted local declared again while an earlier declaration of it
 * is still in scope (the same block or an enclosing one). The native backend
 * keeps one slot per local and releases it at every declaring scope's exit,
 * so such a redeclaration leaks the outer value and releases the inner one
 * twice. */
function nestedRedeclarations(body: IrStmt[], refLocals: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const walk = (stmts: IrStmt[], live: ReadonlySet<string>): void => {
    const scope = new Set(live);
    for (const s of stmts) walkStmt(s, scope);
  };
  const walkStmt = (s: IrStmt, scope: Set<string>): void => {
    switch (s.kind) {
      case "varDecl":
        if (refLocals.has(s.localId)) {
          if (scope.has(s.localId)) found.push(s.localId);
          scope.add(s.localId);
        }
        break;
      case "if":
        walk(s.then, scope);
        if (s.else_) walk(s.else_, scope);
        break;
      case "while":
        walk(s.body, scope);
        break;
      case "for": {
        const inner = new Set(scope);
        if (s.init) walkStmt(s.init, inner);
        walk(s.body, inner);
        break;
      }
      case "block":
        walk(s.body, scope);
        break;
      default:
        break;
    }
  };
  walk(body, new Set());
  return found;
}

test.each([
  ["sort", false],
  ["toSorted", true],
])("%s's helper never redeclares an element local inside its live scope", (_name, copyFirst) => {
  const fn = buildArraySortFn("%arr.sort.test", STRING, 2, copyFirst, null, loc);
  const elementLocals = new Set(fn.locals.filter((l) => l.type.kind === "string").map((l) => l.id));
  expect(elementLocals.size).toBeGreaterThan(0);
  expect(nestedRedeclarations(fn.body, elementLocals)).toEqual([]);
});
