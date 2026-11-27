// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import * as ts from "./ts7/adapter.js";

/** Whether an identifier in a function body reads the runtime arguments object. */
function isArgumentsRead(id: ts.Identifier): boolean {
  const parent = id.parent;
  // A shorthand object property reads its value, but other `name` positions
  // declare a binding or spell a property (including `o.arguments`).
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if ((parent as ts.Node & { name?: ts.Node }).name === id) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false;
  if (ts.isLabeledStatement(parent) && parent.label === id) return false;
  if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === id) return false;
  return true;
}

/** Does this function's own body read `arguments`? Nested plain functions and
 * methods own theirs; arrows inherit the enclosing one. */
export function bodyReadsArguments(fn: ts.Node): boolean {
  if (fn.body === undefined) return false;
  let found = false;
  // Iterative walking preserves the frontend's nesting fence on deep trees.
  ts.walkPreorder(fn.body, (node) => {
    if (ts.isTypeNode(node)) return "skip";
    if (ts.isIdentifier(node) && node.text === "arguments" && isArgumentsRead(node)) {
      found = true;
      return "stop";
    }
    if (ts.isFunctionLike(node) && !ts.isArrowFunction(node) && node !== fn) {
      return "skip";
    }
    return undefined;
  });
  return found;
}

/** Does this function's own body produce a value on some path: a
 * `return <expr>` statement, or a concise arrow body? Nested functions own
 * their returns. */
export function bodyReturnsValue(fn: ts.Node): boolean {
  if (fn.body === undefined) return false;
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return true;
  let found = false;
  ts.walkPreorder(fn.body, (node) => {
    if (ts.isTypeNode(node)) return "skip";
    if (ts.isReturnStatement(node) && node.expression) { found = true; return "stop"; }
    if (ts.isFunctionLike(node) && node !== fn) return "skip";
    return undefined;
  });
  return found;
}
