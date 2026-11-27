// Typed host modules (HOST_IMPORT_ABI §7): an ambiently declared module (`declare module "host:gpu" { export function ... }`) whose
// specifier resolves to no package. Each exported function is a wasm import (module = the specifier, name = the export name) with a
// signature from its declaration; any other export kind, or a type outside the ABI, is a compile-time refusal.
import { browserTarget, isHostModuleScheme, strictHostModulesEnabled } from "../browser-target.js";
import * as ts from "../ts7/adapter.js";
import type { SrcLoc } from "../../ir/ir.js";
import type { Lowerer } from "./lowerer.js";
import { locOf } from "../program.js";
import { BYTES_U8, JSVAL, STRING, type IrExpr, type IrFunction, type IrStmt, type IrType } from "../../ir/ir.js";
import { newFnCtx } from "./lowerer.js";

const declarations = new WeakMap<object, Map<string, ts.ModuleDeclaration>>();

/** The ambient `declare module "<spec>"` declarations of the program, by specifier. */
function ambientModules(lowerer: Lowerer): Map<string, ts.ModuleDeclaration> {
  let found = declarations.get(lowerer.program);
  if (found) return found;
  found = new Map();
  for (const file of lowerer.program.getSourceFiles()) {
    for (const stmt of file.statements) {
      if (ts.isModuleDeclaration(stmt) && ts.isStringLiteral(stmt.name) && stmt.body !== undefined && ts.isModuleBlock(stmt.body) &&
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) {
        found.set(stmt.name.text, stmt);
      }
    }
  }
  declarations.set(lowerer.program, found);
  return found;
}

/** The ambient module declaration a specifier names when it takes the typed host path: browser target, a `declare module` of exactly that
 * name, and a `scheme:name` specifier of a host-module scheme (hostModuleSchemes; never a package or a relative path). */
export function hostModuleDeclaration(lowerer: Lowerer, spec: string): ts.ModuleDeclaration | null {
  if (!browserTarget() || !isHostModuleScheme(spec)) return null;
  const owner = ambientModules(lowerer).get(spec) ?? null;
  if (owner === null || strictHostModulesEnabled()) return owner;
  // Off by default: a module the typed ABI cannot express wholly stays on the untyped page-module path (island.import).
  let verdict = expressible.get(owner);
  if (verdict === undefined) { verdict = moduleExpressible(lowerer, owner); expressible.set(owner, verdict); }
  return verdict ? owner : null;
}

const expressible = new WeakMap<ts.ModuleDeclaration, boolean>();
function moduleExpressible(lowerer: Lowerer, owner: ts.ModuleDeclaration): boolean {
  for (const stmt of (owner.body as ts.ModuleBlock).statements) {
    if (ts.isImportDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
    if (!ts.isFunctionDeclaration(stmt) || stmt.name === undefined || stmt.type === undefined) return false;
    if (stmt.typeParameters !== undefined && stmt.typeParameters.length > 0) return false;
    if (stmt.parameters.some((p) => p.questionToken !== undefined || p.initializer !== undefined || p.dotDotDotToken !== undefined || abiType(lowerer, p.name, false) === null)) return false;
    if (abiType(lowerer, stmt.type, true) === null) return false;
  }
  return true;
}

/** The exported function declaration a binding names in a typed host module, or null. */
function hostFunctionOf(lowerer: Lowerer, ident: ts.Identifier): { module: string; name: string; decl: ts.FunctionDeclaration } | null {
  let symbol = lowerer.checker.getSymbolAtLocation(ident);
  if (!symbol) return null;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = lowerer.checker.getAliasedSymbol(symbol);
  for (const decl of lowerer.checker.declarationsOf(symbol)) {
    if (!ts.isFunctionDeclaration(decl) || decl.name === undefined) continue;
    const block = decl.parent;
    if (!ts.isModuleBlock(block)) continue;
    const owner = block.parent;
    if (!ts.isModuleDeclaration(owner) || !ts.isStringLiteral(owner.name)) continue;
    if (ambientModules(lowerer).get(owner.name.text) === owner && hostModuleDeclaration(lowerer, owner.name.text) === owner) {
      return { module: owner.name.text, name: decl.name.text, decl };
    }
  }
  return null;
}

/** Collection-time check of an import from a typed host module: only named function imports are allowed. Returns false when the
 * statement is not a typed host module import at all. */
export function checkHostModuleImport(lowerer: Lowerer, stmt: ts.ImportDeclaration, spec: string): boolean {
  const owner = hostModuleDeclaration(lowerer, spec);
  if (owner === null) return false;
  const clause = stmt.importClause;
  if (clause === undefined) {
    refuse(lowerer, stmt, `a side-effect import of the host module '${spec}' (import its functions by name)`);
    return true;
  }
  if (clause.name !== undefined) refuse(lowerer, stmt, `the default import of the host module '${spec}' (a host module exports named functions)`);
  const bindings = clause.namedBindings;
  if (bindings !== undefined && ts.isNamespaceImport(bindings)) refuse(lowerer, stmt, `a namespace import of the host module '${spec}' (import its functions by name)`);
  if (bindings !== undefined && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (element.isTypeOnly || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      const exported = (element.propertyName ?? element.name).text;
      const declared = (owner.body as ts.ModuleBlock).statements.filter((s) =>
        (ts.isFunctionDeclaration(s) && s.name?.text === exported) ||
        ((ts.isVariableStatement(s)) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === exported)) ||
        ((ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name?.text === exported));
      if (declared.length === 0) continue; // an interface/type alias (type-only use) or an undeclared name: tsc reports it
      if (!declared.every((s) => ts.isFunctionDeclaration(s))) {
        refuse(lowerer, element, `'${exported}' of the host module '${spec}' is not a function (a host module exports functions only)`);
      }
    }
  }
  return true;
}

function refuse(lowerer: Lowerer, node: ts.Node, message: string): void {
  try { lowerer.unsupported("SC1090", node, message); } catch { /* the diagnostic is recorded; collection goes on */ }
}

/** The IR type a host-module parameter or result of declared type `t` crosses as, or null outside the ABI. */
function abiType(lowerer: Lowerer, node: ts.Node, result: boolean): IrType | null {
  const declared = lowerer.typeOf(node);
  const mapped = lowerer.mapTypeOf(declared);
  if (mapped === null) return null;
  // A page object crosses only by its interface or class (a DOM or host handle); an anonymous object shape is a dictionary, not a handle.
  const symbolName = declared.getSymbol?.()?.name;
  if (mapped.kind === "jsval" && (symbolName === "__type" || symbolName === "__object")) return null;
  const scalar = (t: IrType): boolean => t.kind === "f64" || t.kind === "bool" || t.kind === "string" || t.kind === "jsval";
  if (scalar(mapped)) return mapped;
  // A Uint8Array crosses as a page view over module memory, valid for the call (a host that keeps it copies it); as a result it is copied into
  // compiled storage at once, and a Promise of one is settled with the host's array and copied in on await.
  if (mapped.kind === "bytes" && mapped.elem === "u8") return mapped;
  if (result && mapped.kind === "void") return mapped;
  if (result && mapped.kind === "promise" && (mapped.inner.kind === "void" || scalar(mapped.inner) || (mapped.inner.kind === "bytes" && mapped.inner.elem === "u8"))) return mapped;
  return null;
}

/** `fn(args)` where `fn` is a function imported from a typed host module: one wasm import call. */
export function lowerHostModuleCall(lowerer: Lowerer, call: ts.CallExpression): IrExpr | null {
  if (!ts.isIdentifier(call.expression) || call.questionDotToken !== undefined) return null;
  const host = hostFunctionOf(lowerer, call.expression);
  if (host === null) return null;
  const { decl, module, name } = host;
  const where = `${module}.${name}`;
  if (call.arguments.some(ts.isSpreadElement)) lowerer.unsupported("SC1090", call, `a spread argument in the host call ${where}`);
  if (decl.typeParameters !== undefined && decl.typeParameters.length > 0) lowerer.unsupported("SC1090", decl, `a generic host function ${where}`);
  if (call.arguments.length !== decl.parameters.length || decl.parameters.some((p) => p.questionToken !== undefined || p.initializer !== undefined || p.dotDotDotToken !== undefined)) {
    lowerer.unsupported("SC1090", call, `the host call ${where} must pass exactly its ${decl.parameters.length} declared parameters (no optional or rest parameters cross a host module)`);
  }
  const loc = locOf(call);
  const args: IrExpr[] = [];
  decl.parameters.forEach((p, i) => {
    const t = abiType(lowerer, p.name, false);
    if (t === null) lowerer.unsupported("SC1090", p, `the parameter type of the host function ${where} (host module parameters are number, boolean, string, or a page object)`);
    args.push(lowerer.lowerExprExpecting(call.arguments[i]!, t!));
  });
  const resultNode = decl.type;
  if (resultNode === undefined) lowerer.unsupported("SC1090", decl, `the host function ${where} needs a declared result type`);
  const resultType = abiType(lowerer, resultNode!, true);
  if (resultType === null) lowerer.unsupported("SC1090", decl, `the result type of the host function ${where} (host module results are number, boolean, string, a page object, Uint8Array, void, or a Promise of those)`);
  if (resultType!.kind === "promise" && resultType!.inner.kind === "bytes") {
    return { kind: "call", callee: ensureHostBytesPromise(lowerer, module, name, args.map((a) => a.type), loc), args, type: resultType!, loc };
  }
  return { kind: "libCall", fn: "host.call", args: [{ kind: "strLit", value: module, type: STRING, loc }, { kind: "strLit", value: name, type: STRING, loc }, ...args], type: resultType!, loc };
}

/** `%hostbytes.<module>.<name>(...)`: an async function over a host call that settles a page object, copied into compiled storage on await
 * (a `Promise<Uint8Array>` result of a host module function). */
function ensureHostBytesPromise(lowerer: Lowerer, module: string, name: string, params: IrType[], loc: SrcLoc): string {
  const fnName = `%hostbytes.${module}.${name}`;
  if (lowerer.liftedFns.some((fn) => fn.name === fnName)) return fnName;
  const funcType: IrType & { kind: "func" } = { kind: "func", params, ret: { kind: "promise", inner: BYTES_U8 } };
  const fnCtx = newFnCtx(true, null, funcType, BYTES_U8);
  fnCtx.isAsync = true;
  lowerer.fnStack.push(fnCtx);
  try {
    const locals = params.map((t, i) => lowerer.declareHiddenLocal(`a${i}`, t));
    const raw = lowerer.declareHiddenLocal("raw", JSVAL);
    const hostCall: IrExpr = { kind: "libCall", fn: "host.call", type: { kind: "promise", inner: JSVAL }, loc,
      args: [{ kind: "strLit", value: module, type: STRING, loc }, { kind: "strLit", value: name, type: STRING, loc },
        ...locals.map((l): IrExpr => ({ kind: "varRef", localId: l.id, type: l.type, loc }))] };
    const body: IrStmt[] = [
      { kind: "varDecl", localId: raw.id, init: { kind: "awaitExpr", value: hostCall, type: JSVAL, loc }, loc },
      { kind: "return", value: { kind: "jsExit", value: { kind: "varRef", localId: raw.id, type: JSVAL, loc }, type: BYTES_U8, loc }, loc },
    ];
    const fn: IrFunction = { name: fnName, params: locals.map((l) => ({ localId: l.id, name: l.name, type: l.type })), returnType: BYTES_U8,
      locals: fnCtx.locals, captures: fnCtx.captures!, body, loc, async: true };
    lowerer.liftedFns.push(fn);
  } finally {
    lowerer.fnStack.pop();
  }
  return fnName;
}

/** A host-module function used as a value (stored, passed as a callback): a closure over a generated function whose body is the host call. */
export function lowerHostModuleValue(lowerer: Lowerer, ident: ts.Identifier): IrExpr | null {
  const host = hostFunctionOf(lowerer, ident);
  if (host === null) return null;
  const { decl, module, name } = host;
  const where = `${module}.${name}`, loc = locOf(ident);
  if (decl.typeParameters !== undefined && decl.typeParameters.length > 0) lowerer.unsupported("SC1090", decl, `a generic host function ${where}`);
  if (decl.parameters.some((p) => p.questionToken !== undefined || p.initializer !== undefined || p.dotDotDotToken !== undefined)) {
    lowerer.unsupported("SC1090", decl, `the host function ${where} has optional or rest parameters (none cross a host module)`);
  }
  const params: IrType[] = decl.parameters.map((p) => {
    const t = abiType(lowerer, p.name, false);
    if (t === null) lowerer.unsupported("SC1090", p, `the parameter type of the host function ${where} (host module parameters are number, boolean, string, or a page object)`);
    return t!;
  });
  if (decl.type === undefined) lowerer.unsupported("SC1090", decl, `the host function ${where} needs a declared result type`);
  const ret = abiType(lowerer, decl.type!, true);
  if (ret === null) lowerer.unsupported("SC1090", decl, `the result type of the host function ${where} (host module results are number, boolean, string, a page object, Uint8Array, void, or a Promise of those)`);
  if (ret!.kind === "promise" && ret!.inner.kind === "bytes") {
    return { kind: "closure", fnName: ensureHostBytesPromise(lowerer, module, name, params, loc), captures: [], type: { kind: "func", params, ret: ret! }, loc };
  }
  const fnName = `%host.${module}.${name}`;
  const type: IrType = { kind: "func", params, ret: ret! };
  if (!lowerer.liftedFns.some((fn) => fn.name === fnName)) {
    const ids = params.map((_, i) => `a.${i}`);
    lowerer.liftedFns.push({
      name: fnName,
      params: params.map((t, i) => ({ localId: ids[i]!, name: `a${i}`, type: t })),
      returnType: ret!,
      locals: params.map((t, i) => ({ id: ids[i]!, name: `a${i}`, type: t, mutable: false })),
      body: [{ kind: "return", value: { kind: "libCall", fn: "host.call", type: ret!, loc,
        args: [{ kind: "strLit", value: module, type: STRING, loc }, { kind: "strLit", value: name, type: STRING, loc },
          ...params.map((t, i): IrExpr => ({ kind: "varRef", localId: ids[i]!, type: t, loc }))] }, loc }],
      loc,
    });
  }
  return { kind: "closure", fnName, captures: [], type, loc };
}


