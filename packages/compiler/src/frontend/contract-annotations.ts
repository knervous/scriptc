/* Contract annotations (docs/intrinsics.md, @scriptc/types): where a program
 * writes a fixed-width integer contract type on a slot. A syntactic scan:
 * a type reference is a contract when its name is imported from
 * `@scriptc/types` or from an intrinsic library module that declares the
 * aliases (the `int` library, wherever it is installed). ir/contract-check.ts
 * proves the writes. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as ts from "./ts7/adapter.js";
import { intrinsicPragma } from "../ir/intrinsic-libraries.js";
import type { ContractAnnotation, ContractKind } from "../ir/contract-check.js";
import { CONTRACT_KINDS } from "../ir/contract-check.js";

const CONTRACT_NAMES: ReadonlySet<string> = new Set(CONTRACT_KINDS);

/** Annotations in `sf`. `contractSource(specifier)` tells whether an import
 * specifier of `sf` names a module that declares the contract aliases. */
export function collectContractAnnotations(
  sf: ts.SourceFile,
  contractSource: (specifier: string) => boolean,
  trusted: boolean,
): ContractAnnotation[] {
  const aliases = new Map<string, ContractKind>();
  if (trusted)
    // An intrinsic library uses its own aliases, declared in the file itself.
    for (const name of CONTRACT_NAMES) aliases.set(name, name as ContractKind);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!contractSource(stmt.moduleSpecifier.text)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (CONTRACT_NAMES.has(imported)) aliases.set(el.name.text, imported as ContractKind);
    }
  }
  if (aliases.size === 0) return [];
  const out: ContractAnnotation[] = [];
  const file = sf.fileName;
  const kindOf = (type: ts.TypeNode | undefined): ContractKind | null =>
    type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && !type.typeArguments
      ? aliases.get(type.typeName.text) ?? null
      : null;
  const visit = (node: ts.Node): void => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const kind = kindOf(node.type);
      if (kind) out.push({ kind, slot: "binding", file, start: node.name.getStart(sf), end: node.name.end, name: node.name.text, trusted });
    }
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isGetAccessorDeclaration(node)) {
      const kind = kindOf(node.type);
      if (kind) out.push({ kind, slot: "return", file, start: node.getStart(sf), end: node.end, trusted });
    }
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)))
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) continue;
        if (ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
        const kind = kindOf(member.type);
        if (kind) out.push({ kind, slot: "field", file, start: node.getStart(sf), end: node.end, name: member.name.text, at: member.name.getStart(sf), trusted });
      }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

const PACKAGE_SOURCES: ReadonlySet<string> = new Set(["@scriptc/types", "scriptw/int", "@scriptc/intrinsics/int"]);
const pragmaCache = new Map<string, boolean>();
/** Whether `specifier`, imported from `fromFile`, names a module declaring the contract aliases: @scriptc/types, the
 * int library's package names, or a relative path to a module whose pragma is the int library. */
export function isContractSource(specifier: string, fromFile: string): boolean {
  if (PACKAGE_SOURCES.has(specifier)) return true;
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return false;
  const base = resolve(dirname(fromFile), specifier);
  for (const file of [base, `${base}.ts`, base.replace(/\.m?js$/, ".ts"), `${base}/index.ts`]) {
    let known = pragmaCache.get(file);
    if (known === undefined) {
      known = existsSync(file) && /\.[mc]?[jt]s$/.test(file) && intrinsicPragma(readFileSync(file, "utf8").slice(0, 4096))?.library === "int";
      pragmaCache.set(file, known);
    }
    if (known) return true;
  }
  return false;
}
