// Remove `any` from the port where a precise form type-checks: per site, try the candidates in order and keep the
// first that leaves the program's error count no higher. Sites no candidate fixes are listed for hand work.
//   TS_PATH=<typescript 5.9> node deany.cjs <port dir> [file filter regex]
//   `X as any`      -> `X` | `X!` | `X as <contextual type>`
//   `: any` (var)   -> no annotation (inferred) | `: unknown`
//   `: any` (param) -> `: unknown`
//   `catch (e: any)`-> `catch (e: unknown)`
const ts = require(process.env.TS_PATH);
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2]);
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const config = ts.parseJsonConfigFileContent(JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")), ts.sys, root);
const texts = new Map();
const versions = new Map();
const read = (f) => { let t = texts.get(f); if (t === undefined) { t = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined; texts.set(f, t); } return t; };
const host = {
  getScriptFileNames: () => config.fileNames,
  getScriptVersion: (f) => String(versions.get(f) ?? 0),
  getScriptSnapshot: (f) => { const t = read(f); return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t); },
  getCurrentDirectory: () => root,
  getCompilationSettings: () => config.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: (f) => read(f) !== undefined, readFile: read, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
const errorCount = () => {
  const program = ls.getProgram();
  let n = 0;
  for (const sf of program.getSourceFiles()) if (!sf.isDeclarationFile) n += program.getSemanticDiagnostics(sf).length + program.getSyntacticDiagnostics(sf).length;
  return n;
};
const setText = (f, t) => { texts.set(f, t); versions.set(f, (versions.get(f) ?? 0) + 1); };

let base = errorCount();
console.log(`start: ${base} errors`);
const files = ls.getProgram().getSourceFiles().filter((sf) => !sf.isDeclarationFile && sf.fileName.startsWith(root) && (!only || only.test(sf.fileName))).map((sf) => sf.fileName);
const stats = { fixed: 0, left: 0 };
const leftovers = [];
for (const file of files) {
  // Re-scan after each kept edit: positions move. Sites are visited last-to-first so earlier offsets hold.
  let skip = 0;
  for (;;) {
    const program = ls.getProgram();
    const sf = program.getSourceFile(file);
    const checker = program.getTypeChecker();
    const sites = [];
    const visit = (n) => {
      if (ts.isAsExpression(n) && n.type.kind === ts.SyntaxKind.AnyKeyword) sites.push({ kind: "as", node: n });
      else if (n.kind === ts.SyntaxKind.AnyKeyword && n.parent && (ts.isVariableDeclaration(n.parent) || ts.isParameter(n.parent)) && n.parent.type === n) sites.push({ kind: "decl", node: n.parent });
      ts.forEachChild(n, visit);
    };
    visit(sf);
    sites.sort((a, b) => b.node.getStart(sf) - a.node.getStart(sf));
    if (skip >= sites.length) break;
    const site = sites[skip];
    const text = sf.text;
    const candidates = [];
    if (site.kind === "as") {
      const n = site.node;
      // Strip the parentheses the codemod wrapped around the cast when the result stands alone.
      let outer = n;
      while (ts.isParenthesizedExpression(outer.parent) && outer.parent.expression === outer) outer = outer.parent;
      const inner = n.expression.getText(sf);
      const span = [outer.getStart(sf), outer.getEnd()];
      const needsParens = !ts.isIdentifier(n.expression) && !ts.isPropertyAccessExpression(n.expression) && !ts.isCallExpression(n.expression) && !ts.isElementAccessExpression(n.expression) && !ts.isParenthesizedExpression(n.expression);
      const wrap = (s) => (outer !== n || needsParens ? `(${s})` : s);
      const p = needsParens ? `(${inner})` : inner;
      candidates.push([span, outer === n ? p : `(${p})`]);
      // `null as any` stays for hand work: `null!` would claim a non-null value.
      if (n.expression.kind !== ts.SyntaxKind.NullKeyword && !(ts.isIdentifier(n.expression) && n.expression.text === "undefined")) candidates.push([span, wrap(`${p}!`)]);
      const ctx = checker.getContextualType(outer);
      if (ctx && !(ctx.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) {
        const t = checker.typeToString(ctx, outer, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
        if (!/\bany\b|import\(/.test(t)) candidates.push([span, `(${p} as ${t})`]);
      }
    } else {
      const d = site.node;
      const typeSpan = [d.type.getFullStart() - 1, d.type.getEnd()]; // includes the ':'
      if (text[typeSpan[0]] !== ":") { skip++; continue; }
      if (ts.isVariableDeclaration(d) && d.initializer) candidates.push([typeSpan, ""]);
      if (ts.isCatchClause(d.parent)) candidates.push([typeSpan, ": unknown"]);
      else candidates.push([typeSpan, ": unknown"]);
    }
    let kept = false;
    for (const [[a, b], rep] of candidates) {
      setText(file, text.slice(0, a) + rep + text.slice(b));
      const n = errorCount();
      if (n <= base) { base = n; kept = true; break; }
    }
    if (kept) { stats.fixed++; continue; }
    setText(file, text);
    const { line } = sf.getLineAndCharacterOfPosition(site.node.getStart(sf));
    leftovers.push(`${path.relative(root, file)}:${line + 1}: ${site.node.getText(sf).replace(/\s+/g, " ").slice(0, 120)}`);
    stats.left++;
    skip++;
  }
  const t = texts.get(file);
  if (t !== fs.readFileSync(file, "utf8")) fs.writeFileSync(file, t);
  process.stdout.write(`${path.relative(root, file)} fixed=${stats.fixed} left=${stats.left} errors=${base}\n`);
}
fs.writeFileSync(path.join(root, "..", "deany-left.txt"), leftovers.join("\n") + "\n");
console.log(JSON.stringify({ ...stats, errors: base }));
