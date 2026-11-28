/* Forwarding imports for --npm-static. A published ESM barrel often imports names only to list them in one local
 * export clause:
 *
 *   import { a, b as c } from "./m.js";
 *   export { a, c };
 *
 * which is `export { a, b as c } from "./m.js"` in every observable respect: the module request keeps its place in the
 * module's request order, and a local import binding that nothing else reads is not observable. The re-export form is
 * what the side-effect-free pruning (npm-static-prune.ts) can drop when no importer asks for its names, as a bundler
 * drops it; the import form keeps every module the barrel names. So the text is respelled to the re-export form, with
 * every offset outside the export clause unchanged (`import` and `export` have the same length), and the forwarded
 * names leave the local export clause.
 *
 * An import respells only when every one of its bindings is forwarded under its own local name (`export { c }`, not
 * `export { c as d }`), is named nowhere else in the file (any other identifier with its spelling declines, a property
 * name included: conservative), and is not type-only; a default or namespace import declines. */

import * as ts from "./ts7/syntax.js";

export function applyNpmStaticForwardingImports(sourceFile: ts.SourceFile, source: string): string | null {
  const clauses: ts.ExportDeclaration[] = [];
  const imports: ts.ImportDeclaration[] = [];
  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier === undefined && !stmt.isTypeOnly &&
        stmt.exportClause !== undefined && ts.isNamedExports(stmt.exportClause)) clauses.push(stmt);
    else if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) imports.push(stmt);
  }
  if (clauses.length === 0 || imports.length === 0) return null;

  // Every specifier of the local export clauses, by local name.
  const specifiers = new Map<string, ts.ExportSpecifier[]>();
  for (const clause of clauses) {
    for (const element of (clause.exportClause as ts.NamedExports).elements) {
      const local = (element.propertyName ?? element.name).text;
      const list = specifiers.get(local) ?? [];
      list.push(element);
      specifiers.set(local, list);
    }
  }
  // How often each spelling occurs as an identifier anywhere in the file.
  const occurrences = new Map<string, number>();
  const count = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) occurrences.set(node.text, (occurrences.get(node.text) ?? 0) + 1);
    ts.forEachChild(node, count);
  };
  count(sourceFile);

  const forwarded: ts.ImportDeclaration[] = [];
  const removed = new Set<ts.ExportSpecifier>();
  for (const stmt of imports) {
    const clause = stmt.importClause;
    if (clause === undefined || clause.isTypeOnly || clause.name !== undefined) continue;
    const bindings = clause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings) || bindings.elements.length === 0) continue;
    const take: ts.ExportSpecifier[] = [];
    const ok = bindings.elements.every((element) => {
      if (element.isTypeOnly) return false;
      const local = element.name.text;
      const list = specifiers.get(local);
      if (list === undefined || list.length !== 1) return false;
      const spec = list[0]!;
      if (spec.isTypeOnly || spec.propertyName !== undefined) return false;
      // The import's own name (and its property name when it spells the same), and the export specifier's.
      const own = 1 + (element.propertyName !== undefined && element.propertyName.text === local ? 1 : 0) + 1;
      if ((occurrences.get(local) ?? 0) !== own) return false;
      take.push(spec);
      return true;
    });
    if (!ok) continue;
    forwarded.push(stmt);
    for (const spec of take) removed.add(spec);
  }
  if (forwarded.length === 0) return null;

  const edits: { start: number; end: number; text: string }[] = [];
  for (const stmt of forwarded) {
    const start = stmt.getStart(sourceFile);
    if (source.slice(start, start + 6) !== "import") return null;
    edits.push({ start, end: start + 6, text: "export" });
  }
  for (const clause of clauses) {
    const named = clause.exportClause as ts.NamedExports;
    if (!named.elements.some((element) => removed.has(element))) continue;
    // The text between the braces, respelled with the kept specifiers and padded to its length (its line breaks kept).
    const open = source.indexOf("{", named.getStart(sourceFile));
    const close = named.getEnd() - 1;
    if (open < 0 || source[close] !== "}") return null;
    const original = source.slice(open + 1, close);
    const kept = named.elements.filter((element) => !removed.has(element))
      .map((element) => source.slice(element.getStart(sourceFile), element.getEnd())).join(", ");
    const breaks = original.replace(/[^\n]/g, "");
    const body = ` ${kept} `;
    if (body.length + breaks.length > original.length) return null;
    edits.push({ start: open + 1, end: close, text: body + " ".repeat(original.length - body.length - breaks.length) + breaks });
  }
  let text = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}
