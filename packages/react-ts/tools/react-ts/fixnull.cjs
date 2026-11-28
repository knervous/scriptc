// Add `!` where the checker reports a possibly-null dereference: a property access, element access or call on an
// `X | null | undefined` value. In JavaScript those sites throw on null; the assertion keeps that (a compiled `!`
// traps). Only dereferences are touched: a nullable value flowing into a non-null slot is left for hand work.
//   TS_PATH=<typescript 5.9> node fixnull.cjs <port dir> [file filter regex]
const ts = require(process.env.TS_PATH);
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2]);
const only = process.argv[3] && process.argv[3] !== "-" ? new RegExp(process.argv[3]) : null;
// Expressions React's Flow types declare non-null though they start out null (`null as any`): where one flows into
// a non-null slot (2322/2345), it gets the same assertion.
const declaredNonNull = new Set((process.argv[4] ?? "").split(",").filter(Boolean));
const config = ts.parseJsonConfigFileContent(JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")), ts.sys, root);
// 18047/18048/18049: 'x' is possibly null/undefined; 2531/2532/2533: object is possibly null/undefined;
// 2721/2722/2723: cannot invoke an object which is possibly null/undefined.
const CODES = new Set([18047, 18048, 18049, 2531, 2532, 2533, 2721, 2722, 2723]);
let total = 0;
for (let round = 1; round <= 20; round++) {
  const program = ts.createProgram(config.fileNames, config.options);
  const byFile = new Map();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !sf.fileName.startsWith(root) || (only && !only.test(sf.fileName))) continue;
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (d.start === undefined) continue;
      if (!CODES.has(d.code)) {
        if ((d.code !== 2322 && d.code !== 2345) || !declaredNonNull.has(sf.text.slice(d.start, d.start + d.length))) continue;
        // 2322 on a declaration spans the name; the assignment check needs the initializer.
        const diagText = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        if (!/null/.test(diagText)) continue;
      }
      const list = byFile.get(sf) ?? [];
      list.push([d.start, d.start + d.length]);
      byFile.set(sf, list);
    }
  }
  if (byFile.size === 0) break;
  let n = 0;
  for (const [sf, spans] of byFile) {
    let text = sf.text;
    const seen = new Set();
    for (const [a, b] of spans.sort((x, y) => y[0] - x[0])) {
      if (seen.has(b)) continue;
      seen.add(b);
      // The node spanning exactly the diagnostic.
      let node;
      const find = (x) => { if (x.getStart(sf) === a && x.getEnd() === b && ts.isExpression(x)) node = x; if (x.pos <= a && x.end >= b) ts.forEachChild(x, find); };
      find(sf);
      if (!node) continue;
      const simple = ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node) || ts.isParenthesizedExpression(node) || node.kind === ts.SyntaxKind.ThisKeyword;
      text = simple ? text.slice(0, b) + "!" + text.slice(b) : text.slice(0, a) + "(" + text.slice(a, b) + ")!" + text.slice(b);
      n++;
    }
    fs.writeFileSync(sf.fileName, text);
  }
  total += n;
  console.log(`round ${round}: ${n} assertions`);
  if (n === 0) break;
}
console.log(`total ${total}`);
