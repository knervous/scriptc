import * as ts from "../ts7/adapter.js";

/* Fields a constructor may expose unassigned (Node's pre-assignment read is undefined, which a monomorphic layout cannot hold).
 *
 * A small analysis walks the field initializers and the constructor body in evaluation order, with the set of own initializer-less
 * fields not yet assigned. A statement exposes `this` when it can hand the instance to other code before the assignment: a method call
 * on `this`, `this` as an argument, value or capture, an accessor read, or a `super(...)` call whose base constructor does. Every field
 * still unassigned at such a point is exposed, and so is one the constructor reads (`this.f`) before it assigns it. */

const classExposeMemo = new WeakMap<ts.ClassLikeDeclaration, boolean>();

/** Whether constructing an instance of `decl` can run code that sees `this` before the constructor body finishes (its own initializers and
 * constructor body, or its base's). */
export function constructionExposesThis(
  decl: ts.ClassLikeDeclaration,
  baseOf: (decl: ts.ClassLikeDeclaration) => ts.ClassLikeDeclaration | null,
): boolean {
  const memo = classExposeMemo.get(decl);
  if (memo !== undefined) return memo;
  classExposeMemo.set(decl, true); // a cycle answers conservatively
  let result = false;
  const base = baseOf(decl);
  if (base !== null && constructionExposesThis(base, baseOf)) result = true;
  if (!result) {
    for (const member of decl.members) {
      if (ts.isPropertyDeclaration(member) && member.initializer && !isStaticMember(member) && !ts.isArrowFunction(skipParens(member.initializer)) && !ts.isFunctionExpression(skipParens(member.initializer)) &&
          scan(member.initializer, new Set()).exposes) result = true;
      if (ts.isConstructorDeclaration(member) && member.body) {
        for (const statement of member.body.statements) {
          if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword) continue;
          if (scan(statement, new Set()).exposes) result = true;
        }
      }
    }
  }
  classExposeMemo.set(decl, result);
  return result;
}

interface Scan {
  /** `this` reaches other code (or an accessor/method). */
  exposes: boolean;
  /** Candidate fields read as plain `this.f`. */
  reads: Set<string>;
}

function scan(root: ts.Node, candidates: ReadonlySet<string>): Scan {
  const out: Scan = { exposes: false, reads: new Set() };
  const visit = (node: ts.Node, insideArrow: boolean): void => {
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      // A bare `this` (argument, value, return, capture) reaches other code.
      out.exposes = true;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const parent = node.parent;
      const name = node.name.text;
      const isStore = ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      const isCall = ts.isCallExpression(parent) && parent.expression === node;
      if (isCall || insideArrow) out.exposes = true;
      else if (isStore) { /* a store hands nothing out */ }
      else if (candidates.has(name)) out.reads.add(name);
      else if (!isPlainFieldName(node)) out.exposes = true;
      return;
    }
    if (ts.isArrowFunction(node)) {
      let capturesThis = false;
      const probe = (child: ts.Node): void => {
        if (child.kind === ts.SyntaxKind.ThisKeyword) capturesThis = true;
        if (!capturesThis && !ts.isFunctionExpression(child) && !ts.isFunctionDeclaration(child) && !isClassLike(child)) ts.forEachChild(child, probe);
      };
      ts.forEachChild(node, probe);
      if (capturesThis) out.exposes = true;
      return;
    }
    // Functions and classes have their own `this`.
    if (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || isClassLike(node)) return;
    if (node.kind === ts.SyntaxKind.SuperKeyword) { out.exposes = true; return; }
    ts.forEachChild(node, (child) => visit(child, insideArrow));
  };
  visit(root, false);
  return out;
}

/** A `this.name` read that is not an accessor or method reference. The checker is not consulted: a name that is a method of the class
 * reads as a plain property access too, so only a call (handled above) exposes. */
function isPlainFieldName(_node: ts.PropertyAccessExpression): boolean {
  return true;
}

/** The own fields (`candidates`: initializer-less ones assigned by the constructor, and fields with initializers) that initializers or the constructor may expose before they are assigned. */
export function exposedFields(
  decl: ts.ClassLikeDeclaration,
  ctor: ts.ConstructorDeclaration | undefined,
  candidates: ReadonlySet<string>,
  baseExposes: boolean,
): Set<string> {
  const exposed = new Set<string>();
  if (candidates.size === 0) return exposed;
  const unassigned = new Set(candidates);
  const expose = (names: Iterable<string>): void => { for (const name of names) if (unassigned.has(name)) exposed.add(name); };
  // Field initializers run before the constructor body (after super()).
  let superSeen = false;
  const afterSuper = (): void => {
    if (superSeen) return;
    superSeen = true;
    if (baseExposes) expose(unassigned);
  };
  if (decl.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword) && !ctor) afterSuper();
  const statements = ctor?.body?.statements ?? [];
  const first = statements[0];
  const startsWithSuper = first !== undefined && ts.isExpressionStatement(first) && ts.isCallExpression(first.expression) && first.expression.expression.kind === ts.SyntaxKind.SuperKeyword;
  if (!startsWithSuper) afterSuper();
  let initializers = false;
  const runInitializers = (): void => {
    if (initializers) return;
    initializers = true;
    for (const member of decl.members) {
      if (!ts.isPropertyDeclaration(member) || !member.initializer || isStaticMember(member)) continue;
      // A function-valued initializer only creates the closure: nothing runs (or sees `this`) until it is called, which a call on
      // `this`, a bare `this` or a capture elsewhere in the construction accounts for.
      const initializer = skipParens(member.initializer);
      if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) {
        const found = scan(member.initializer, unassigned);
        expose(found.reads);
        if (found.exposes) expose(unassigned);
      }
      // The field is defined once its initializer has run.
      if (ts.isIdentifier(member.name)) unassigned.delete(member.name.text);
    }
  };
  if (!startsWithSuper) runInitializers();
  for (const statement of statements) {
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
      const args = scan(statement.expression, unassigned);
      expose(args.reads);
      afterSuper();
      runInitializers();
      continue;
    }
    const found = scan(statement, unassigned);
    expose(found.reads);
    if (found.exposes) expose(unassigned);
    // A top-level `this.f = ...` assigns f once the statement completes.
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) &&
        statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(statement.expression.left) && statement.expression.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
      unassigned.delete(statement.expression.left.name.text);
    }
  }
  return exposed;
}

function skipParens(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
function isStaticMember(member: ts.ClassElement): boolean {
  return ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) === true;
}
function isClassLike(node: ts.Node): boolean {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}
