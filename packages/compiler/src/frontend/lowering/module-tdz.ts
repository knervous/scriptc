/* Module-scope `let`, `const` and `class` bindings that code can read before their declaration has run (the temporal dead zone).
 *
 * Reachability is syntactic. Walking the module's top-level statements in order, each statement runs its own code (the direct code of an
 * expression, initializers, static initializers, immediately-invoked and call-argument function expressions); a function, method or class
 * the executed code names becomes reached, and its whole body runs from then on (nested functions included: conservative). A reference
 * from code that runs while a binding is still uninitialized marks the binding early:
 * - an early `let`/`const` gets an initialization flag: its reads and writes check the flag and throw Node's ReferenceError;
 * - an early class has no checked form (its uses lower through the class registry, not through a binding): it is refused loudly.
 *
 * IMPORT CYCLES. Modules of a cycle (an ES-module strongly connected component of size 2+) run each other's code during initialization.
 * Evaluation order is the depth-first postorder `sourceFiles` carries: when a module's body runs, every module before it in that order has
 * finished, and every module after it that it can name is a DFS ancestor stuck at its import statements — none of its body has run. So
 * for the code a member's body runs (the same reachability walk, now following imported functions, methods and classes across the cycle),
 * a binding of the same module is early when its declaration is at or after the running statement, and a binding of a LATER module is
 * always early; bindings of earlier modules are initialized. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { orderedImportsOf } from "../program.js";

export interface EarlyTdz {
  /** Lexical (`let`/`const`) bindings with an initializer, read or written early. */
  lexical: Set<ts.Symbol>;
  /** Classes used before their declaration ran, with the first early reference. */
  classes: Map<ts.Symbol, { name: ts.Identifier; reference: ts.Identifier }>;
}

interface Candidate {
  name: ts.Identifier;
  index: number;
  symbol: ts.Symbol;
  kind: "lexical" | "class";
  node: ts.Node;
}

export function earlyTdzBindings(lowerer: Lowerer, sourceFiles: readonly ts.SourceFile[]): EarlyTdz {
  const out: EarlyTdz = { lexical: new Set(), classes: new Map() };
  for (const sf of sourceFiles) {
    if (sf.isDeclarationFile) continue;
    analyze(lowerer, sf, out);
  }
  for (const cluster of importCycles(lowerer, sourceFiles)) analyzeCluster(lowerer, cluster, out);
  return out;
}

/** The ES-module import cycles (strongly connected components of two or more modules) among `sourceFiles`, each in evaluation order. */
function importCycles(lowerer: Lowerer, sourceFiles: readonly ts.SourceFile[]): ts.SourceFile[][] {
  const members = new Set(sourceFiles);
  const edges = new Map<ts.SourceFile, ts.SourceFile[]>();
  for (const sf of sourceFiles) {
    if (sf.isDeclarationFile) continue;
    const deps: ts.SourceFile[] = [];
    for (const { dep } of orderedImportsOf(lowerer.program, sf)) if (dep !== null && dep !== sf && members.has(dep) && !deps.includes(dep)) deps.push(dep);
    edges.set(sf, deps);
  }
  const index = new Map<ts.SourceFile, number>();
  const low = new Map<ts.SourceFile, number>();
  const onStack = new Set<ts.SourceFile>();
  const stack: ts.SourceFile[] = [];
  const found: ts.SourceFile[][] = [];
  let next = 0;
  const strong = (v: ts.SourceFile): void => {
    index.set(v, next); low.set(v, next); next++;
    stack.push(v); onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: ts.SourceFile[] = [];
      for (;;) { const w = stack.pop()!; onStack.delete(w); comp.push(w); if (w === v) break; }
      if (comp.length > 1) found.push(sourceFiles.filter((f) => comp.includes(f)));
    }
  };
  for (const sf of sourceFiles) if (edges.has(sf) && !index.has(sf)) strong(sf);
  return found;
}

/** What a cycle's modules share: their top-level lexical bindings and classes, the function-like units a name can run, member units by name. */
interface ClusterCtx {
  rank: Map<ts.SourceFile, number>;
  candidates: Map<ts.Symbol, Candidate & { file: ts.SourceFile }>;
  units: Map<ts.Symbol, ts.Node>;
  methods: Map<string, ts.Node[]>;
}

function collectUnits(lowerer: Lowerer, sf: ts.SourceFile, ctx: ClusterCtx): void {
  const candidates = new Map<ts.Symbol, Candidate>();
  collectDecls(lowerer.checker, sf, candidates, new Set(), ctx.units);
  for (const [symbol, candidate] of candidates) ctx.candidates.set(symbol, { ...candidate, file: sf });
  collectMethods(sf, ctx.methods);
}

function analyzeCluster(lowerer: Lowerer, cluster: readonly ts.SourceFile[], out: EarlyTdz): void {
  const checker = lowerer.checker;
  const ctx: ClusterCtx = { rank: new Map(cluster.map((f, i) => [f, i])), candidates: new Map(), units: new Map(), methods: new Map() };
  for (const sf of cluster) collectUnits(lowerer, sf, ctx);
  if (ctx.candidates.size === 0) return;
  void checker;
  for (const sf of cluster) analyze(lowerer, sf, out, ctx);
}

const peel = (node: ts.Expression): ts.Expression => {
  let e = node;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
};

function isDeclare(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false);
}

function isInside(node: ts.Node, container: ts.Node): boolean {
  return node.pos >= container.pos && node.end <= container.end;
}

function collectDecls(
  checker: Lowerer["checker"], sf: ts.SourceFile,
  candidates: Map<ts.Symbol, Candidate>, unitNames: Set<string>, unitsBySymbol: Map<ts.Symbol, ts.Node>,
): void {
  const statements = sf.statements;
  statements.forEach((s, index) => {
    if (isDeclare(s)) return;
    if (ts.isVariableStatement(s)) {
      const flags = s.declarationList.flags;
      const lexical = (flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0 && (flags & ts.NodeFlags.Using) === 0;
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const symbol = checker.getSymbolAtLocation(d.name);
        if (symbol === undefined) continue;
        if (lexical && d.initializer !== undefined) {
          candidates.set(symbol, { name: d.name, index, symbol, kind: "lexical", node: d });
          unitNames.add(d.name.text);
        }
        const init = d.initializer === undefined ? undefined : peel(d.initializer);
        if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          unitsBySymbol.set(symbol, init);
          unitNames.add(d.name.text);
        }
      }
    } else if (ts.isFunctionDeclaration(s) && s.name !== undefined && s.body !== undefined) {
      const symbol = checker.getSymbolAtLocation(s.name);
      if (symbol !== undefined) { unitsBySymbol.set(symbol, s); unitNames.add(s.name.text); }
    } else if (ts.isClassDeclaration(s) && s.name !== undefined) {
      const symbol = checker.getSymbolAtLocation(s.name);
      if (symbol !== undefined) {
        candidates.set(symbol, { name: s.name, index, symbol, kind: "class", node: s });
        unitsBySymbol.set(symbol, s);
        unitNames.add(s.name.text);
      }
    }
  });
}

/** Function-like members by name: a property access or call naming one may run it. */
function collectMethods(sf: ts.SourceFile, methodsByName: Map<string, ts.Node[]>): void {
  const addMethod = (name: string, node: ts.Node): void => {
    const list = methodsByName.get(name) ?? [];
    list.push(node);
    methodsByName.set(name, list);
  };
  ts.walkPreorder(sf, (node) => {
    if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body !== undefined &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) addMethod(node.name.text, node);
    else if ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) && node.initializer !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      const init = peel(node.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) addMethod(node.name.text, init);
    }
    return undefined;
  });
}

function analyze(lowerer: Lowerer, sf: ts.SourceFile, out: EarlyTdz, cluster?: ClusterCtx): void {
  const checker = lowerer.checker;
  const statements = sf.statements;
  const candidates: Map<ts.Symbol, Candidate> = cluster?.candidates ?? new Map<ts.Symbol, Candidate>();
  const unitNames = new Set<string>();
  const unitsBySymbol: Map<ts.Symbol, ts.Node> = cluster?.units ?? new Map<ts.Symbol, ts.Node>();
  const symbolOf = (id: ts.Identifier): ts.Symbol | undefined => {
    const parent = id.parent;
    if (parent !== undefined && ts.isShorthandPropertyAssignment(parent) && parent.name === id) return checker.getShorthandAssignmentValueSymbol(parent) ?? checker.getSymbolAtLocation(id);
    return checker.getSymbolAtLocation(id);
  };
  if (cluster === undefined) collectDecls(checker, sf, candidates, unitNames, unitsBySymbol);
  if (![...candidates.values()].length) return;
  const methodsByName = cluster?.methods ?? new Map<string, ts.Node[]>();
  if (cluster === undefined) collectMethods(sf, methodsByName);
  const reached = new Set<ts.Node>();
  const queue: ts.Node[] = [];
  const reach = (node: ts.Node): void => {
    if (reached.has(node)) return;
    reached.add(node);
    queue.push(node);
  };
  let current = 0;
  const flagged = new Set<ts.Symbol>();
  const note = (id: ts.Identifier): void => {
    if (cluster === undefined && !unitNames.has(id.text)) return;
    let symbol = symbolOf(id);
    if (symbol === undefined) return;
    // An imported name stands for the exporting module's binding.
    if (cluster !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    const candidate = candidates.get(symbol);
    const early = candidate !== undefined && (cluster === undefined
      ? candidate.index >= current
      : (candidate as Candidate & { file?: ts.SourceFile }).file === sf
        ? candidate.index >= current
        : cluster.rank.get((candidate as Candidate & { file: ts.SourceFile }).file)! > cluster.rank.get(sf)!);
    if (candidate !== undefined && early && id !== candidate.name && !flagged.has(symbol) &&
        !(candidate.kind === "class" && isInside(id, candidate.node))) {
      flagged.add(symbol);
      if (candidate.kind === "lexical") out.lexical.add(symbol);
      else out.classes.set(symbol, { name: candidate.name, reference: id });
    }
    const unit = unitsBySymbol.get(symbol);
    if (unit !== undefined) reach(unit);
  };
  /** The method, accessor or function-valued member a property name resolves to (by symbol: other classes' same-named members do not run). */
  const reachMember = (name: ts.MemberName): void => {
    if (!ts.isIdentifier(name)) return;
    const members = methodsByName.get(name.text);
    if (members === undefined) return;
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol === undefined) { for (const m of members) reach(m); return; } // unresolved: any member of that name
    for (const declaration of checker.declarationsOf(symbol)) {
      if (members.includes(declaration)) reach(declaration);
      else if (ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration)) {
        const init = declaration.initializer === undefined ? undefined : peel(declaration.initializer);
        if (init !== undefined && members.includes(init)) reach(init);
      }
    }
  };
  const immediatelyRun = (node: ts.Node): boolean => {
    let child: ts.Node = node;
    let parent = node.parent;
    while (parent !== undefined && ts.isParenthesizedExpression(parent)) { child = parent; parent = parent.parent; }
    if (parent === undefined) return false;
    if (ts.isCallExpression(parent)) return parent.expression === child || parent.arguments.some((a) => a === child);
    if (ts.isNewExpression(parent)) return parent.arguments?.some((a) => a === child) ?? false;
    return false;
  };
  const visitClass = (node: ts.ClassLikeDeclaration, deep: boolean): void => {
    for (const h of node.heritageClauses ?? []) for (const t of h.types) visit(t.expression, deep);
    for (const member of node.members) {
      if (member.name !== undefined && ts.isComputedPropertyName(member.name)) visit(member.name.expression, deep);
      const isStatic = (ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false);
      if (ts.isClassStaticBlockDeclaration(member)) { visit(member.body, true); continue; }
      if (ts.isPropertyDeclaration(member)) {
        if (member.initializer !== undefined && (isStatic || deep)) visit(member.initializer, deep || isStatic);
        continue;
      }
      if (deep) visit(member, true);
    }
  };
  const visit = (node: ts.Node, deep: boolean): void => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isIdentifier(node)) { note(node); return; }
    if (ts.isFunctionLike(node)) {
      if (deep || ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && immediatelyRun(node))) {
        for (const p of (node as ts.FunctionLikeDeclaration).parameters ?? []) if (p.initializer !== undefined) visit(p.initializer, true);
        const body = (node as ts.FunctionLikeDeclaration).body;
        if (body !== undefined) visit(body, true);
      }
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) { visitClass(node, deep); return; }
    if (ts.isPropertyAccessExpression(node)) {
      reachMember(node.name);
      visit(node.expression, deep);
      return;
    }
    if (ts.isVariableDeclaration(node)) { if (node.initializer !== undefined) visit(node.initializer, deep); return; }
    ts.forEachChild(node, (child) => { visit(child, deep); });
  };
  /** Naming a class runs nothing but an instantiation's code: constructors and instance field initializers (and the base class's);
   * methods, accessors and static members run only when named themselves (reachMember). */
  const visitInstantiation = (node: ts.ClassLikeDeclaration): void => {
    for (const h of node.heritageClauses ?? []) for (const t of h.types) visit(t.expression, true);
    for (const member of node.members) {
      const isStatic = (ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false);
      if (isStatic) continue;
      if (ts.isConstructorDeclaration(member)) visit(member, true);
      else if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) visit(member.initializer, true);
    }
  };
  const drain = (): void => {
    while (queue.length > 0) {
      const unit = queue.pop()!;
      if (ts.isClassDeclaration(unit) || ts.isClassExpression(unit)) visitInstantiation(unit);
      else {
        for (const p of (unit as ts.FunctionLikeDeclaration).parameters ?? []) if (p.initializer !== undefined) visit(p.initializer, true);
        const body = (unit as ts.FunctionLikeDeclaration).body;
        if (body !== undefined) visit(body, true);
      }
    }
  };
  statements.forEach((s, index) => {
    current = index;
    if (isDeclare(s) || ts.isFunctionDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isImportDeclaration(s) || ts.isExportDeclaration(s) ||
        ts.isModuleDeclaration(s) || ts.isEnumDeclaration(s)) { drain(); return; }
    if (ts.isClassDeclaration(s)) visitClass(s, false);
    else visit(s, false);
    drain();
  });
}
