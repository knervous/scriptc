// A hand-made site profile for a gate fixture's JS helper: every property
// access `o.<field>` (receiver named `o`) on one of the given fields is a
// monomorphic load or store site of a plain object with exactly those fields,
// as V8 would record it. Rerun after editing the helper (the profile pins its
// sha256):
//   node make-fixture-profile.mjs fixtures/<helper>.js fixtures/<name>.profile.json [a,b,c] [a:s,b:h]
// The optional last list gives V8's field representations (own.how "field:s"
// Smi, "d" double, "h" heap object, "t" tagged) for those fields.
import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto'; import { createRequire } from 'node:module';
const req = createRequire(new URL('../../packages/compiler/package.json', import.meta.url));
const ts = req('typescript5');
const [file, out, list] = process.argv.slice(2), text = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fields = (list ?? 'a,b,c').split(','), sites = [];
const how = Object.fromEntries((process.argv[5] ?? '').split(',').filter(Boolean).map(x => x.split(':')));
const visit = (n) => {
  if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'o' && fields.includes(n.name.text)) {
    const write = ts.isBinaryExpression(n.parent) && n.parent.left === n && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    sites.push({ kind: write ? 'store' : 'load', property: n.name.text, file: path.basename(file), span: { start: n.getStart(), end: n.end }, state: 'monomorphic',
      receivers: [{ kind: 'plain-object', fields, own: { index: fields.indexOf(n.name.text), ...(how[n.name.text] ? { how: `field:${how[n.name.text]}` } : {}) } }] });
  }
  ts.forEachChild(n, visit);
};
visit(sf);
fs.writeFileSync(out, JSON.stringify({ schema: 'scriptc-pgo-site-profile/1', key: `hand-made by make-fixture-profile.mjs: every o.<field> access monomorphic on {${fields.join(',')}}`, pathsRelativeTo: 'this file',
  files: { [path.basename(file)]: { sha256: createHash('sha256').update(text).digest('hex') } }, sites }, null, 1) + '\n');
console.log(sites.length, 'sites');
