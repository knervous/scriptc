/* Defined-branch folding for --npm-static. A package's CommonJS entry often
 * picks its build at load time,
 *
 *   if (process.env.NODE_ENV === 'production') {
 *     module.exports = require('./cjs/react.production.js');
 *   } else {
 *     module.exports = require('./cjs/react.development.js');
 *   }
 *
 * and a bundler given `define` folds the test and keeps one arm. The
 * checker cannot: two `module.exports = require(...)` assignments leave the
 * package's named imports with no binding either world can lower. With a
 * `define` table (CompileBaseOptions.define), a TOP-LEVEL `if` whose test
 * compares a defined free name to a literal is folded here, in the text
 * both worlds read: the test, the braces and the dead arm are blanked with
 * spaces (newlines kept, so every offset and line survives) and the live
 * arm's statements stay where they were, now at the top level, as the
 * bundled form has them.
 *
 * Unwrapping a block changes scope only for declarations, so an arm that
 * declares anything (var, let, const, function, class) keeps its `if`
 * untouched; so does a test the table does not decide, and a file that
 * declares the defined name's root itself (a local `process` is not the
 * free name `define` replaces). */

import * as ts from "./ts7/syntax.js";

type Defined = string | number | boolean | null;

/** The dotted free name an expression spells (`process.env.NODE_ENV`), or null. */
function dottedName(e: ts.Expression): string | null {
  const parts: string[] = [];
  let node: ts.Expression = e;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  while (ts.isPropertyAccessExpression(node) && !node.questionDotToken && ts.isIdentifier(node.name)) {
    parts.unshift(node.name.text);
    node = node.expression;
  }
  if (!ts.isIdentifier(node)) return null;
  parts.unshift(node.text);
  return parts.join(".");
}

/** A literal operand's value: a string, a finite number, true, false or null (undefined when it is not one). */
function literalValue(e: ts.Expression): Defined | undefined {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  return undefined;
}

/** The test's value under the table: `name OP literal` or `literal OP name`
 * with OP one of === !== == !=, or a bare defined name; undefined when the
 * table does not decide it. (`==` between a string and a number coerces, so
 * only same-typed operands fold.) */
function decide(test: ts.Expression, table: ReadonlyMap<string, Defined>, rootsDeclared: ReadonlySet<string>): boolean | undefined {
  while (ts.isParenthesizedExpression(test)) test = test.expression;
  const lookup = (e: ts.Expression): Defined | undefined => {
    const name = dottedName(e);
    if (name === null || !table.has(name) || rootsDeclared.has(name.split(".")[0]!)) return undefined;
    return table.get(name);
  };
  if (ts.isPrefixUnaryExpression(test) && test.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = decide(test.operand, table, rootsDeclared);
    return inner === undefined ? undefined : !inner;
  }
  if (ts.isBinaryExpression(test)) {
    const op = test.operatorToken.kind;
    const equal = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
    const notEqual = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
    if (!equal && !notEqual) return undefined;
    let a = lookup(test.left), b = literalValue(test.right);
    if (a === undefined || b === undefined) { a = lookup(test.right); b = literalValue(test.left); }
    if (a === undefined || b === undefined || typeof a !== typeof b) return undefined;
    return (a === b) === equal;
  }
  const v = lookup(test);
  return v === undefined ? undefined : Boolean(v);
}

const declares = (s: ts.Statement): boolean =>
  ts.isVariableStatement(s) || ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s);

/** The names a file declares at its top level (the roots a defined name must not be shadowed by). */
function topLevelNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const s of sourceFile.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) names.add(s.name.text);
  }
  return names;
}

/** The source with its decided top-level `if`s folded, or null when none is. */
export function applyNpmStaticDefinedBranches(sourceFile: ts.SourceFile, source: string, table: ReadonlyMap<string, Defined>): string | null {
  if (table.size === 0) return null;
  const roots = new Set([...table.keys()].map((k) => k.split(".")[0]!));
  if (![...roots].some((r) => source.includes(r))) return null;
  const declared = topLevelNames(sourceFile);
  const blank: [number, number][] = [];
  for (const s of sourceFile.statements) {
    if (!ts.isIfStatement(s)) continue;
    const taken = decide(s.expression, table, declared);
    if (taken === undefined) continue;
    const live = taken ? s.thenStatement : s.elseStatement;
    const body = live === undefined ? [] : ts.isBlock(live) ? [...live.statements] : [live];
    if (body.some(declares)) continue;
    const start = s.getStart(sourceFile), end = s.getEnd();
    if (body.length === 0) { blank.push([start, end]); continue; }
    blank.push([start, body[0]!.getFullStart()], [body[body.length - 1]!.getEnd(), end]);
  }
  if (blank.length === 0) return null;
  let out = "", at = 0;
  for (const [from, to] of blank) {
    out += source.slice(at, from);
    for (let i = from; i < to; i++) out += source[i] === "\n" || source[i] === "\r" ? source[i] : " ";
    at = to;
  }
  return out + source.slice(at);
}
