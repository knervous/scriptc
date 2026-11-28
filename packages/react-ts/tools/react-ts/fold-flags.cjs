// Fold React's build-time flags into the converted TypeScript source: the production client build
// (__DEV__ = __PROFILE__ = __EXPERIMENTAL__ = false, shared/ReactFeatureFlags defaults), then
// constant-fold the branches that become decidable and report the modules the client entry points reach.
//   node fold-flags.cjs <packages dir> <out dir>
const ts = require(process.env.TS_PATH);
const fs = require("fs");
const path = require("path");

const [root, outRoot] = process.argv.slice(2);
const BUILD = { __DEV__: false, __PROFILE__: false, __EXPERIMENTAL__: false, __VARIANT__: false };

// 1. The flag values: evaluate the `export const x[: T] = <expr>` initializers of React's feature flags
// (shared/ReactFeatureFlags) and the scheduler's (scheduler/src/SchedulerFeatureFlags).
const FLAG_SOURCES = [
  { file: "shared/ReactFeatureFlags.ts", spec: /shared\/ReactFeatureFlags$/ },
  { file: "scheduler/src/SchedulerFeatureFlags.ts", spec: /SchedulerFeatureFlags$/ },
];
const flags = {};
const reactFlagNames = new Set();
const evalExpr = (e, env) => {
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isStringLiteral(e)) return e.text;
  if (ts.isParenthesizedExpression(e)) return evalExpr(e.expression, env);
  if (ts.isIdentifier(e) && Object.hasOwn(env, e.text)) return env[e.text];
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) { const v = evalExpr(e.operand, env); return v === undefined ? undefined : !v; }
  if (ts.isBinaryExpression(e)) {
    const l = evalExpr(e.left, env), r = evalExpr(e.right, env);
    if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return l === false ? false : l === undefined || r === undefined ? undefined : l && r;
    if (e.operatorToken.kind === ts.SyntaxKind.BarBarToken) return l === true ? true : l === undefined || r === undefined ? undefined : l || r;
  }
  return undefined;
};
for (const source of FLAG_SOURCES) {
const flagFile = path.join(root, source.file);
const flagSf = ts.createSourceFile(flagFile, fs.readFileSync(flagFile, "utf8"), ts.ScriptTarget.Latest, true);
for (const st of flagSf.statements) {
  if (!ts.isVariableStatement(st)) continue;
  for (const d of st.declarationList.declarations) {
    if (!ts.isIdentifier(d.name) || !d.initializer) continue;
    const v = evalExpr(d.initializer, { ...BUILD, ...flags });
    if (typeof v === "boolean" || typeof v === "number") { flags[d.name.text] = v; if (source === FLAG_SOURCES[0]) reactFlagNames.add(d.name.text); }
  }
}
}

// 2. Per file: substitute build constants and imported flags, fold, and drop now-unused flag imports.
const literal = (v) => (v === true ? ts.factory.createTrue() : v === false ? ts.factory.createFalse() : ts.factory.createNumericLiteral(String(v)));
const known = (e) => {
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(e)) return known(e.expression);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) { const v = known(e.operand); return v === undefined ? undefined : !v; }
  return undefined;
};
const inPlace = process.env.FOLD_IN_PLACE ? process.env.FOLD_IN_PLACE.split(",").map((f) => path.resolve(root, f)) : null;
const files = [];
const walkDir = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); const s = fs.statSync(p);
  if (s.isDirectory()) { if (!/^(__tests__|__mocks__|server)$/.test(n)) walkDir(p); } else if (/\.tsx?$/.test(n) && !n.endsWith(".d.ts")) files.push(p); } };
if (inPlace) files.push(...inPlace); else walkDir(root);
let folded = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const importedFlags = new Set();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && FLAG_SOURCES.some((s) => s.spec.test(st.moduleSpecifier.text)) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings))
      for (const el of st.importClause.namedBindings.elements) if (Object.hasOwn(flags, (el.propertyName ?? el.name).text)) importedFlags.add(el.name.text);
  }
  const transformer = (ctx) => {
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.parent && !ts.isImportSpecifier(node.parent) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
          !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) && !ts.isTypeReferenceNode(node.parent) &&
          node.parent.name !== node && !ts.isTypeQueryNode(node.parent) && !ts.isShorthandPropertyAssignment(node.parent)) {
        if (Object.hasOwn(BUILD, node.text)) { folded++; return literal(BUILD[node.text]); }
        if (importedFlags.has(node.text) && Object.hasOwn(flags, node.text)) { folded++; return literal(flags[node.text]); }
      }
      node = ts.visitEachChild(node, visit, ctx);
      if (ts.isIfStatement(node)) {
        const v = known(node.expression);
        if (v === true) return node.thenStatement;
        if (v === false) return node.elseStatement ?? ts.factory.createEmptyStatement();
      }
      if (ts.isConditionalExpression(node)) { const v = known(node.condition); if (v !== undefined) return v ? node.whenTrue : node.whenFalse; }
      if (ts.isBinaryExpression(node)) {
        const l = known(node.left);
        if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && l !== undefined) return l ? node.right : ts.factory.createFalse();
        if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken && l !== undefined) return l ? ts.factory.createTrue() : node.right;
      }
      if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) { const v = known(node.operand); if (v !== undefined) return v ? ts.factory.createFalse() : ts.factory.createTrue(); }
      return node;
    };
    return (n) => ts.visitNode(n, visit);
  };
  let out = ts.transform(sf, [transformer]).transformed[0];
  // Drop flag imports (their uses are literals now).
  const printer = ts.createPrinter({ removeComments: false });
  let printed = printer.printFile(out);
  const rel = path.relative(root, file);
  const dest = inPlace ? file : path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, printed);
}
if (inPlace) { console.log(JSON.stringify({ folded, files: files.length })); process.exit(0); }
// The flags as the production client build sees them: literal values (the file's own __EXPERIMENTAL__ etc. resolved).
fs.writeFileSync(path.join(outRoot, "shared/ReactFeatureFlags.ts"),
  "// React's feature flags as the production browser client build resolves them (shared/ReactFeatureFlags.js, __DEV__ = __PROFILE__ = __EXPERIMENTAL__ = false).\n" +
  Object.entries(flags).filter(([k]) => reactFlagNames.has(k)).map(([k, v]) => `export const ${k}: ${typeof v} = ${v};`).join("\n") + "\n");
// The browser client build's module forks (scripts/rollup/forks.js): the DOM host config, and the shared internals
// resolved to their client owners (React and React DOM compile into one program, so every importer shares them).
const FORKS = {
  "react-reconciler/src/ReactFiberConfig.ts":
    "export * from 'react-dom-bindings/src/client/ReactFiberConfigDOM';\n",
  "shared/ReactSharedInternals.ts": "export { default } from 'react/src/ReactSharedInternalsClient';\n",
  "shared/ReactDOMSharedInternals.ts": "export { default } from 'react-dom/src/ReactDOMSharedInternals';\n",
};
for (const [rel, text] of Object.entries(FORKS)) fs.writeFileSync(path.join(outRoot, rel), `// Fork resolved for the browser client build (React scripts/rollup/forks.js).\n${text}`);

// 3. Reachability from the client entry points, following relative and package-internal imports.
const resolve = (from, spec) => {
  let base;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else { const [pkg, ...rest] = spec.split("/"); if (!fs.existsSync(path.join(outRoot, pkg))) return null; base = path.join(outRoot, pkg, rest.join("/") || "index"); }
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) if (fs.existsSync(c)) return c;
  return null;
};
const entries = ["react-dom/client.ts", "react-dom/index.ts", "react/index.ts", "react/jsx-runtime.ts", "scheduler/index.ts"].map((e) => path.join(outRoot, e)).filter((e) => fs.existsSync(e));
const reached = new Set(); const queue = [...entries];
while (queue.length) {
  const f = queue.pop(); if (reached.has(f)) continue; reached.add(f);
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  for (const st of sf.statements) {
    if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier) {
      const r = resolve(f, st.moduleSpecifier.text); if (r) queue.push(r);
    }
  }
}
// Prune: only the modules the client entry points reach stay.
const all = []; const walkOut = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walkOut(p); else if (/\.tsx?$/.test(n)) all.push(p); } };
walkOut(outRoot);
let pruned = 0;
for (const f of all) if (!reached.has(f)) { fs.unlinkSync(f); pruned++; }
let lines = 0, anys = 0;
const byPkg = {};
for (const f of reached) { const t = fs.readFileSync(f, "utf8"); const n = t.split("\n").length; lines += n; anys += (t.match(/\bany\b/g) || []).length; const pkg = path.relative(outRoot, f).split(path.sep)[0]; byPkg[pkg] = (byPkg[pkg] || 0) + n; }
console.log(JSON.stringify({ flags: Object.keys(flags).length, folded, pruned, files: files.length, reachedModules: reached.size, reachedLines: lines, reachedAny: anys, byPkg }, null, 1));
