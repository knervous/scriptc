// Dead-code removal over the folded port: a top-level declaration (function, class, variable, type, interface,
// enum) that nothing else references is removed, repeated until nothing changes. The client entry points keep
// every export; a removed declaration's now-unused imports are removed too. Then empty modules are deleted.
//   node dce.cjs <folded dir>
const ts = require(process.env.TS_PATH);
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2]);
const config = ts.parseJsonConfigFileContent(JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")), ts.sys, root);
const ENTRY = new Set(config.fileNames.map((f) => path.resolve(f)));
const versions = new Map();
const snapshots = new Map();
const exists = new Map();
const files = () => {
  const out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n)) out.push(p); } };
  walk(root);
  return out;
};
let fileList = files();
const host = {
  getScriptFileNames: () => fileList,
  getScriptVersion: (f) => String(versions.get(f) ?? 0),
  // One read per file version: the language service asks for snapshots on every query.
  getScriptSnapshot: (f) => {
    const key = `${f}\u0000${versions.get(f) ?? 0}`;
    let snap = snapshots.get(key);
    if (snap === undefined) { snap = fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8")) : null; snapshots.set(key, snap); }
    return snap ?? undefined;
  },
  getCurrentDirectory: () => root,
  getCompilationSettings: () => ({ ...config.options, noEmit: true }),
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: (f) => { let v = exists.get(f); if (v === undefined) { v = ts.sys.fileExists(f); exists.set(f, v); } return v; }, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());

const declNames = (st) => {
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) return [st.name];
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => (ts.isIdentifier(d.name) ? d.name : null)).filter(Boolean);
  return [];
};
// A variable whose initializer may have effects (a call, `new`) is kept even when unreferenced.
const pure = (st) => {
  if (!ts.isVariableStatement(st)) return true;
  let effect = false;
  const visit = (n) => { if (ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n)) { if (!ts.isArrowFunction(n.parent) && !ts.isFunctionExpression(n.parent)) effect = true; } if (!ts.isArrowFunction(n) && !ts.isFunctionExpression(n)) ts.forEachChild(n, visit); };
  for (const d of st.declarationList.declarations) if (d.initializer) visit(d.initializer);
  return !effect;
};

// Unused import specifiers (and declarations left empty) are removed in place, in every file; the order of the
// remaining imports is kept. A bare `import 'x'` is kept (it is imported for its effects).
const pruneImports = () => {
  let pruned = 0;
  const program = ls.getProgram();
  for (const file of fileList) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const cuts = [];
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause) continue;
      const clause = st.importClause;
      const names = [];
      if (clause.name) names.push({ id: clause.name, node: clause.name });
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) names.push({ id: clause.namedBindings.name, node: clause.namedBindings });
        else for (const el of clause.namedBindings.elements) names.push({ id: el.name, node: el });
      }
      const unused = names.filter(({ id }) => !(ls.findReferences(file, id.getStart(sf)) ?? []).some((r) => r.references.some((e) => !e.isDefinition)));
      if (unused.length === 0) continue;
      pruned += unused.length;
      if (unused.length === names.length) { cuts.push([st.getFullStart(), st.getEnd(), ""]); continue; }
      // Rebuild the clause from the used names.
      const keep = names.filter((n) => !unused.includes(n));
      const def = keep.find((n) => n.node === clause.name);
      const named = keep.filter((n) => n.node !== clause.name);
      let text = "import " + (clause.isTypeOnly ? "type " : "");
      const parts = [];
      if (def) parts.push(def.id.text);
      if (named.length) {
        if (ts.isNamespaceImport(clause.namedBindings)) parts.push(named[0].node.getText(sf));
        else parts.push("{ " + named.map((n) => n.node.getText(sf)).join(", ") + " }");
      }
      text += parts.join(", ") + " from " + st.moduleSpecifier.getText(sf) + ";";
      cuts.push([st.getStart(sf), st.getEnd(), text]);
    }
    if (cuts.length === 0) continue;
    let text = sf.text;
    for (const [a, b, rep] of cuts.sort((x, y) => y[0] - x[0])) text = text.slice(0, a) + rep + text.slice(b);
    fs.writeFileSync(file, text);
    versions.set(file, (versions.get(file) ?? 0) + 1);
  }
  return pruned;
};

let round = 0, removedTotal = 0;
for (;;) {
  round++;
  const prunedImports = pruneImports();
  if (prunedImports) console.log(`round ${round}: removed ${prunedImports} unused imports`);
  const program = ls.getProgram();
  const edits = new Map(); // file -> [start, end][]
  for (const file of fileList) {
    if (ENTRY.has(path.resolve(file))) continue;
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    for (const st of sf.statements) {
      const names = declNames(st);
      if (names.length === 0 || !pure(st)) continue;
      // Overload signatures and declaration merging share a name: judge by the name's references.
      const used = names.some((name) => {
        const refs = ls.findReferences(file, name.getStart(sf)) ?? [];
        for (const r of refs) for (const e of r.references) {
          if (e.isDefinition) continue;
          // An export specifier `export {x}` alone is not a use unless it is re-exported to a used place: count it.
          return true;
        }
        return false;
      });
      if (!used) {
        const list = edits.get(file) ?? [];
        list.push([st.getFullStart(), st.getEnd()]);
        edits.set(file, list);
      }
    }
  }
  if (edits.size === 0 && prunedImports === 0) break;
  let removed = 0;
  for (const [file, ranges] of edits) {
    let text = fs.readFileSync(file, "utf8");
    for (const [a, b] of ranges.sort((x, y) => y[0] - x[0])) { text = text.slice(0, a) + text.slice(b); removed++; }
    fs.writeFileSync(file, text);
    versions.set(file, (versions.get(file) ?? 0) + 1);
  }
  removedTotal += removed;
  console.log(`round ${round}: removed ${removed} declarations`);
  if (round > 40) break;
}
// Modules left with no statements but imports re-exports are kept; modules with nothing at all are deleted.
let emptied = 0;
for (const file of fileList) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  if (!ENTRY.has(path.resolve(file)) && sf.statements.length === 0) { fs.unlinkSync(file); emptied++; }
}
let lines = 0;
for (const f of files()) lines += fs.readFileSync(f, "utf8").split("\n").length;
console.log(JSON.stringify({ rounds: round, removedTotal, emptied, lines, modules: files().length }));
