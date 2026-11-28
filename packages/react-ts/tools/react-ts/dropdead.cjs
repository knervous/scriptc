// Remove statements that can never run: in a statement list, everything after a statement that always leaves
// (return, throw, break, continue, or a bare block ending in one). Flag folding leaves these behind
// (`if (!enableX) return;` becomes `{ return; }` followed by the feature's code). Function declarations and `var`
// statements are kept (they are hoisted, so removing them could change what a name resolves to).
// Text edits in place; formatting elsewhere is untouched.
//   TS_PATH=<typescript> node dropdead.cjs <dir> [file filter regex]
const ts = require(process.env.TS_PATH);
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2]);
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const files = [];
const walk = (d) => { for (const n of fs.readdirSync(d)) { if (n === ".git" || n === "node_modules") continue; const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n) && !n.endsWith(".d.ts")) files.push(p); } };
walk(root);

const exits = (st) => {
  if (ts.isReturnStatement(st) || ts.isThrowStatement(st) || ts.isBreakStatement(st) || ts.isContinueStatement(st)) return true;
  if (ts.isBlock(st)) { const last = st.statements.filter((s) => !ts.isEmptyStatement(s)).at(-1); return !!last && exits(last); }
  return false;
};
const hoisted = (st) => ts.isFunctionDeclaration(st) || (ts.isVariableStatement(st) && !(st.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)));

let removed = 0;
for (const file of files) {
  if (only && !only.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const cuts = [];
  const visitList = (stmts) => {
    let dead = false;
    for (const st of stmts) {
      if (dead) {
        if (!hoisted(st) && !ts.isEmptyStatement(st)) cuts.push([st.getFullStart(), st.getEnd()]);
        continue;
      }
      if (exits(st)) dead = true;
    }
  };
  const visit = (n) => {
    if (ts.isBlock(n) || ts.isModuleBlock(n)) visitList(n.statements);
    else if (ts.isCaseClause(n) || ts.isDefaultClause(n)) visitList(n.statements);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (cuts.length === 0) continue;
  // Nested cuts: keep only the outermost.
  cuts.sort((a, b) => a[0] - b[0]);
  const outer = [];
  for (const c of cuts) if (!outer.length || c[0] >= outer.at(-1)[1]) outer.push(c);
  let out = text;
  for (const [a, b] of outer.reverse()) out = out.slice(0, a) + out.slice(b);
  fs.writeFileSync(file, out);
  removed += outer.length;
}
console.log(JSON.stringify({ removed }));
