// List top-level statements that run code at module init (anything beyond declarations and literal initializers).
const ts = require(process.env.TS_PATH);
const fs = require("fs"), path = require("path");
const root = path.resolve(process.argv[2]);
const files = []; const walk = (d) => { for (const n of fs.readdirSync(d)) { if (n === ".git") continue; const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n)) files.push(p); } }; walk(root);
const literalish = (e) => {
  if (!e) return true;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression?.(e)) return literalish(e.expression);
  if (ts.isLiteralExpression(e) || ts.isNoSubstitutionTemplateLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(e)) return true; // a binding read (the fork checks cycle-crossing reads separately)
  if (ts.isPrefixUnaryExpression(e)) return literalish(e.operand);
  if (ts.isBinaryExpression(e)) return literalish(e.left) && literalish(e.right);
  if (ts.isConditionalExpression(e)) return literalish(e.condition) && literalish(e.whenTrue) && literalish(e.whenFalse);
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e)) return true;
  if (ts.isObjectLiteralExpression(e)) return e.properties.every((p) => (ts.isPropertyAssignment(p) ? literalish(p.initializer) : ts.isMethodDeclaration(p) || ts.isShorthandPropertyAssignment(p)));
  if (ts.isArrayLiteralExpression(e)) return e.elements.every(literalish);
  if (ts.isTemplateExpression(e)) return e.templateSpans.every((s) => literalish(s.expression));
  return false;
};
let n = 0;
for (const f of files) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  for (const st of sf.statements) {
    let bad = false;
    if (ts.isVariableStatement(st)) bad = st.declarationList.declarations.some((d) => !literalish(d.initializer));
    else if (ts.isExpressionStatement(st) || ts.isIfStatement(st) || ts.isForStatement(st) || ts.isBlock(st) || ts.isTryStatement(st)) bad = !(ts.isBlock(st) && st.statements.length === 0);
    if (bad) { n++; console.log(`${path.relative(root, f)}:${sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1}: ${st.getText(sf).replace(/\s+/g, " ").slice(0, 120)}`); }
  }
}
console.error(`${n} statements`);
