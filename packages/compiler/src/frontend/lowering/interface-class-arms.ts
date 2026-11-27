import * as ts from "../ts7/adapter.js";
import { constituentTypes } from "../ts7/checker.js";
import type { IrType } from "../../ir/ir.js";
import type { Lowerer } from "./lowerer.js";
import type { FileParts } from "./lower-modules.js";
import { isolatedFromContext, mapType, ShapeRegistry, UnionRegistry, type TypeMapperCtx } from "../type-mapper.js";

/* Structural types that accept classes and narrower records by reference
 * (option `interfaceClassArms`).
 *
 * TypeScript lets a class instance or a wider record flow into a structural
 * type it satisfies (a Vector3 into `{ x; y; z }`, a Standard material into
 * `Material`). A record here is a monomorphic struct, so such a value has no
 * record form of the narrower type without a copy, and a copy breaks the
 * reference semantics TS code relies on (the callee mutates the vector; a
 * material bumps its version through the base type).
 *
 * Before any type is mapped for lowering, this scan walks every expression
 * the checker gives a contextual (target) type, and records two kinds of
 * flow: a program class into a record shape, and one record shape into a
 * different one (width subtyping). It maps types on a mapper of its own with
 * no arms anywhere, so a shape's id here is stable: it does not depend on
 * what the arms make of the types nested in it. The lowering's mapper asks
 * the table for a record type's arms by that stable key, and maps the arms
 * itself (lowerer.resolveInterfaceArms), so the union a type maps to is built
 * from the same mapping as everything around it, recursive types included. */

type ObjectType = IrType & { kind: "object" };

/** A reached shape (keyed by its scan id). */
export interface InterfaceArmsEntry {
  /** Program classes flowing in, subclasses folded into their ancestors. */
  classArms: ObjectType[];
  /** Instantiations of generic program classes flowing in (`Observable<Vec3>`
   * into `{ add(cb): unknown }`): the checker types, mapped by the lowering's
   * own mapper (an instantiation's class name is assigned there). */
  genericArms: ts.Type[];
  /** Narrower record shapes flowing in by value, transitively (scan ids),
   * each one the program builds. Whether one can stand in for this shape by
   * reference is decided when both are mapped for lowering. */
  sources: string[];
  /** The program builds a record of this shape itself: a literal of it, or
   * untyped data cast or passed into it. */
  record: boolean;
}

export interface InterfaceArmsTable {
  entries: Map<string, InterfaceArmsEntry>;
  /** Scan shape id → the checker types seen with that shape. */
  typesOf: Map<string, ts.Type[]>;
  /** Scan shape id of a record that flows by value into wider record types →
   * those types' optional fields it does not declare (transitively). */
  extraFields: Map<string, Array<{ name: string; type: ts.Type }>>;
  /** Class arm name → the optional fields of the shapes it is an arm of that
   * the class does not declare (own or inherited, as any member kind). */
  classExtraFields: Map<string, Array<{ name: string; type: ts.Type }>>;
  /** The same for generic arms, keyed by the generic family's class name. */
  genericExtraFields: Map<string, Array<{ name: string; type: ts.Type }>>;
  /** The scan's own mapper: arms-free, with its own registries and memo. */
  ctx: TypeMapperCtx;
}

/** The scan's key for a checker type: its arms-free record shape id.
 *
 * The key is a function of the CHECKER type, in the scan's own registry. The
 * scan's mapper copies the lowerer's type-parameter hooks, whose answers are
 * IR types of the LOWERER's registry (a bound `T` is a record with a lowerer
 * shape id): consulted while an instance body lowers, they would hand back an
 * id of the wrong registry, and `T`'s bound record would take the arms of
 * whatever unrelated shape the scan numbered the same. So the key maps with
 * type parameters bound only through their checker types (`tsBinding`), mapped
 * here in the scan's registry; a parameter with no checker binding is no key. */
export function interfaceArmsKey(
  table: InterfaceArmsTable,
  type: ts.Type,
  tsBinding?: (param: ts.Type) => ts.Type | null,
): string | null {
  try {
    const keyCtx: TypeMapperCtx = {
      ...table.ctx,
      resolveTypeParam: (param) => {
        const bound = tsBinding?.(param);
        return bound && bound !== param ? mapType(bound, keyCtx) : null;
      },
      resolveTypeParamTs: (param) => tsBinding?.(param) ?? null,
    };
    const mapped = isolatedFromContext(() => mapType(type, keyCtx));
    return mapped?.kind === "record" ? mapped.shapeId : null;
  } catch {
    return null;
  }
}

/** SCRIPTC_ICA_COUNTS=1: the scan's checker queries counted per method (calls, distinct arguments or argument pairs,
 * milliseconds), printed with the scan's own counters when it ends, to choose what to make cheaper. */
function countingChecker(inner: ts.TypeChecker): { checker: ts.TypeChecker; report(): Record<string, { calls: number; distinct: number; ms: number }> } {
  const stats = new Map<string, { calls: number; ms: number; distinct: Set<unknown>; pairs: Map<unknown, Set<unknown>> }>();
  const wrapped = new Map<string, (...args: unknown[]) => unknown>();
  const checker = new Proxy(inner, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function" || typeof prop !== "string") return value;
      let wrapper = wrapped.get(prop);
      if (!wrapper) {
        const fn = value as (...args: unknown[]) => unknown;
        const s = { calls: 0, ms: 0, distinct: new Set<unknown>(), pairs: new Map<unknown, Set<unknown>>() };
        stats.set(prop, s);
        wrapper = (...args: unknown[]): unknown => {
          s.calls++;
          if (args.length >= 2 && args[1] !== undefined) {
            let seconds = s.pairs.get(args[0]);
            if (!seconds) s.pairs.set(args[0], (seconds = new Set()));
            seconds.add(args[1]);
          } else s.distinct.add(args[0]);
          const t = performance.now();
          try { return fn.apply(target, args); } finally { s.ms += performance.now() - t; }
        };
        wrapped.set(prop, wrapper);
      }
      return wrapper;
    },
  });
  const report = () => Object.fromEntries([...stats].sort(([, a], [, b]) => b.ms - a.ms).map(([name, s]) => [name, {
    calls: s.calls, distinct: s.distinct.size + [...s.pairs.values()].reduce((n, seconds) => n + seconds.size, 0), ms: Math.round(s.ms),
  }]));
  return { checker, report };
}

export function scanInterfaceArms(lowerer: Lowerer, parts: readonly FileParts[]): InterfaceArmsTable {
  const counting = process.env["SCRIPTC_ICA_COUNTS"] === "1" ? countingChecker(lowerer.checker) : null;
  const checker = counting?.checker ?? lowerer.checker;
  const icaStart = performance.now();
  const ica = { visits: 0, records: 0, deepFlowCalls: 0, deepFlowMemoSkips: 0, deepFlowParts: 0, phases: {} as Record<string, number> };
  // Arms-free, registry-separate mapping. Hooks that would register classes
  // in the lowerer as a side effect (generic, local and mixin class
  // instances) answer nothing here: such classes do not take part in the
  // scan.
  const { armsFor: _armsFor, noteArmsUnion: _noteArmsUnion, extraRecordFields: _extraRecordFields, ...base } = lowerer.typeCtx;
  const ctx: TypeMapperCtx = {
    ...base,
    ...(counting ? { checker: counting.checker } : {}),
    shapes: new ShapeRegistry(),
    unions: new UnionRegistry(),
    typeMemo: new Map(),
    // An instantiation of a generic program class names a stable stand-in
    // keyed by the checker type, so a structural type mentioning one (`drain(
    // arena: Arena<Item>)`) still has a scan shape. The class never takes part
    // as an arm (programClassOf declines generic classes) and registers nothing.
    genericClassInstance: (decl, ref) => ({ kind: "object", className: `%scan.${lowerer.classNamer(decl)}.${(ref as { id?: number }).id ?? lowerer.checker.typeToString(ref)}` }),
    localClassInstance: () => null,
    mixinClassInstance: () => null,
    mixinIntersectionInstance: () => null,
  };
  const classArms = new Map<string, Map<string, ObjectType>>();
  // Record shapes flowing into a wider shape BY VALUE (not a literal, which
  // builds the wider shape directly): source shapes by destination.
  const recordSources = new Map<string, Set<string>>();
  // Assertions across shapes TS cannot relate by assignability (`cam as
  // Provider`, where Cam lacks Provider's members but its classes carry
  // them): the source shape's class arms that ARE the destination's flow
  // in, resolved after the scan once every shape's arms are known.
  const asserted: Array<{ from: string; into: string; dst: ts.Type }> = [];
  const typesOf = new Map<string, ts.Type[]>();
  const built = new Set<string>();
  const markBuilt = (shape: string, node: ts.Node, why: string): void => {
    if (process.env.SCRIPTC_DEBUG_ICA && !built.has(shape)) {
      console.error(`ICA-BUILT ${shape} ${why} ${node.getSourceFile().fileName.split("/").slice(-2).join("/")}: ${node.getText().slice(0, 60).replace(/\s+/g, " ")}`);
    }
    built.add(shape);
  };
  const diagsBefore = lowerer.diags.length;

  const mapQuietly = (t: ts.Type): IrType | null => {
    try {
      return mapType(t, ctx);
    } catch {
      return null;
    }
  };
  const recordShapeOf = (t: ts.Type): string | null => {
    const mapped = mapQuietly(t);
    if (mapped?.kind !== "record") return null;
    const shape = ctx.shapes.get(mapped.shapeId);
    if (!shape || shape.tuple || shape.indexValue || shape.fields.length === 0 ||
      shape.fields.some((f) => f.name.startsWith("%") && !/^%[gs]et:/.test(f.name))) return null;
    const seen = typesOf.get(mapped.shapeId) ?? [];
    if (!seen.includes(t) && seen.length < 16) seen.push(t);
    typesOf.set(mapped.shapeId, seen);
    return mapped.shapeId;
  };
  // Each class arm's declaration, for the ancestry check below.
  const declOf = new Map<string, ts.ClassLikeDeclaration>();
  /** Stand-in class name of a generic instantiation arm → its checker type. */
  const genericInstanceOf = new Map<string, ts.Type>();
  const instanceOf = new Map<string, ts.Type>();
  const programClassOf = (t: ts.Type): ObjectType | null => {
    const symbol = t.getSymbol();
    if (!symbol || (symbol.flags & ts.SymbolFlags.Class) === 0) return null;
    const decl = checker.declarationsOf(symbol).find((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d)) as
      ts.ClassLikeDeclaration | undefined;
    if (!decl || !lowerer.typeCtx.isProgramFile?.(decl.getSourceFile())) return null;
    const mapped = mapQuietly(t);
    if (mapped?.kind !== "object") return null;
    // A generic class takes part as an INSTANTIATION arm: the scan's stand-in
    // name keys the flow, the lowering maps the checker type to the real class.
    if (decl.typeParameters) {
      if (!mapped.className.startsWith("%scan.")) return null;
      genericInstanceOf.set(mapped.className, t);
    }
    declOf.set(mapped.className, decl);
    instanceOf.set(mapped.className, t);
    return mapped;
  };
  /** The program classes `decl` extends, nearest first. */
  const ancestorsOf = (decl: ts.ClassLikeDeclaration): string[] => {
    const names: string[] = [];
    let at: ts.ClassLikeDeclaration | undefined = decl;
    for (let depth = 0; at && depth < 32; depth++) {
      const base = at.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
      if (!base) break;
      let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(base) ? base.name : base);
      if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
      const next = symbol ? checker.declarationsOf(symbol).find((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d)) as
        ts.ClassLikeDeclaration | undefined : undefined;
      if (!next) break;
      names.push(lowerer.classNamer(next));
      at = next;
    }
    return names;
  };
  // tsgo's API can panic serializing some union constituents (a tuple
  // reference among them); its handler recovers, and such a type is skipped.
  const partsOf = (t: ts.Type): readonly ts.Type[] => {
    if ((t.flags & ts.TypeFlags.Union) === 0) return [t];
    try {
      return constituentTypes(t);
    } catch {
      return [];
    }
  };
  const present = (t: ts.Type): readonly ts.Type[] =>
    partsOf(t).filter((part) => (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) === 0);

  const visit = (node: ts.Node): void => {
    ica.visits++;
    if (ts.isTypeNode(node)) return;
    if (ts.isExpression(node) && !ts.isParenthesizedExpression(node)) {
      // A node kind the checker API cannot answer for (tsgo can panic
      // serializing some types) is not a flow this scan can see.
      try {
        record(node);
      } catch {
        // skipped
      }
    }
    ts.forEachChild(node, visit);
  };
  const isUntyped = (t: ts.Type): boolean => (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
  /** `null as any`, `undefined as unknown as T`: untyped, but never a record. */
  const isUnitLiteral = (node: ts.Expression): boolean => {
    let at: ts.Expression = node;
    while (ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isParenthesizedExpression(at) || ts.isNonNullExpression(at)) at = at.expression;
    return at.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(at) && at.text === "undefined") || ts.isVoidExpression(at);
  };
  const elementOf = (t: ts.Type): ts.Type | null => {
    try {
      if (!checker.isArrayType(t)) return null;
      return checker.getTypeArguments(t as ts.TypeReference)[0] ?? null;
    } catch {
      return null;
    }
  };
  const addClassArm = (dstShape: string, cls: ObjectType): void => {
    const arms = classArms.get(dstShape) ?? new Map<string, ObjectType>();
    arms.set(cls.className, cls);
    classArms.set(dstShape, arms);
  };
  /** Flows between the parts of two types TypeScript relates, below the
   * expression the checker typed: array elements, and the fields of records
   * that stand in for a wider record. */
  // The same pair of types reaches deepFlow from many expressions (every call site of a function passes its arguments into
  // the same parameter types): a pair already followed from this depth or shallower is not followed again. Its effects
  // (arms added, shapes and classes noted) are idempotent, and a shallower walk reaches everything a deeper one would; the
  // top level is its own case (it skips a part flowing into its own shape). A walk that threw is not remembered, so a
  // repeat throws where it did. (On a large program's modules: ~160k getPropertyOfType round trips per piece without this.)
  // A source's properties by name, from one getPropertiesOfType (cached per type) instead of a getPropertyOfType round
  // trip per destination property (~160k per large module, most of them names the source lacks). The same symbols: both
  // read the type's resolved members (an intersection's merged ones from the same property cache). Beyond that list,
  // getPropertyOfType answers only the global Object and Function interfaces' members, so a missing name is asked about
  // only when it is one of theirs (all of them, whatever the names, when the program augments either interface).
  const augmentsObjectOrFunction = lowerer.program.getSourceFiles().some((sf) =>
    !/[\\/]lib\.[^\\/]*\.d\.ts$/.test(sf.fileName) && /\binterface\s+(?:Object|Function)\s*[<{]/.test(sf.text));
  const OBJECT_AND_FUNCTION_MEMBERS = new Set(["constructor", "toString", "toLocaleString", "valueOf", "hasOwnProperty",
    "isPrototypeOf", "propertyIsEnumerable", "apply", "call", "bind", "prototype", "length", "arguments", "caller", "name"]);
  const mayInherit = (name: string): boolean => augmentsObjectOrFunction || OBJECT_AND_FUNCTION_MEMBERS.has(name);
  const ownPropertiesOf = new Map<ts.Type, Map<string, ts.Symbol>>();
  const ownProperties = (t: ts.Type): Map<string, ts.Symbol> => {
    let byName = ownPropertiesOf.get(t);
    if (!byName) {
      byName = new Map();
      for (const prop of checker.getPropertiesOfType(t)) if (!byName.has(prop.name)) byName.set(prop.name, prop);
      ownPropertiesOf.set(t, byName);
    }
    return byName;
  };
  const followed = new Map<ts.Type, Map<ts.Type, number>>();
  const followedTop = new Map<ts.Type, Set<ts.Type>>();
  const deepFlow = (src: ts.Type, dst: ts.Type, depth: number): void => {
    ica.deepFlowCalls++;
    if (depth > 4 || src === dst) return;
    if (depth === 0 ? followedTop.get(src)?.has(dst) : (followed.get(src)?.get(dst) ?? Infinity) <= depth) { ica.deepFlowMemoSkips++; return; }
    ica.deepFlowParts++;
    deepFlowParts(src, dst, depth);
    if (depth === 0) {
      let into = followedTop.get(src);
      if (!into) followedTop.set(src, (into = new Set()));
      into.add(dst);
    } else {
      let into = followed.get(src);
      if (!into) followed.set(src, (into = new Map()));
      into.set(dst, Math.min(into.get(dst) ?? Infinity, depth));
    }
  };
  const deepFlowParts = (src: ts.Type, dst: ts.Type, depth: number): void => {
    for (const d of present(dst)) {
      for (const s of present(src)) {
        if (isUntyped(s) || isUntyped(d)) continue;
        const se = elementOf(s);
        const de = elementOf(d);
        if (se && de) {
          deepFlow(se, de, depth + 1);
          continue;
        }
        if (se || de) continue;
        const dstShape = programClassOf(d) ? null : recordShapeOf(d);
        if (!dstShape) continue;
        const cls = programClassOf(s);
        const srcShape = cls ? null : recordShapeOf(s);
        if (!cls && !srcShape) continue;
        if (srcShape === dstShape && depth === 0) continue;
        if (!checker.isTypeAssignableTo(s, d)) continue;
        // Only instantiations of generic classes are arms found this way:
        // they reach a slot through a wrapper the checker typed without the
        // slot (their instantiations cannot be told apart by name). Plain
        // classes and records keep to the direct flows.
        if (cls) {
          if (genericInstanceOf.has(cls.className)) addClassArm(dstShape, cls);
          continue;
        }
        if (srcShape === null) continue;
        const own = ownProperties(s);
        for (const prop of checker.getPropertiesOfType(d)) {
          if (prop.name.startsWith("__@")) continue;
          const sp = own.get(prop.name) ?? (mayInherit(prop.name) ? checker.getPropertyOfType(s, prop.name) : undefined);
          if (sp) deepFlow(checker.getTypeOfSymbol(sp), checker.getTypeOfSymbol(prop), depth + 1);
        }
      }
    }
  };
  const record = (node: ts.Expression): void => {
    ica.records++;
    const ownType = checker.getTypeAtLocation(node);
    const own = present(ownType);
    // Record origins: an object literal builds its own shape; untyped data
    // asserted or passed into a shape may be a record of it.
    if (ts.isObjectLiteralExpression(node)) {
      for (const part of own) {
        const shape = recordShapeOf(part);
        if (shape) markBuilt(shape, node, "literal");
      }
    }
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      if (present(checker.getTypeAtLocation(node.expression)).some(isUntyped) && !isUnitLiteral(node.expression)) {
        for (const part of own) {
          const shape = recordShapeOf(part);
          if (shape) markBuilt(shape, node, "cast");
        }
      }
    }
    if (own.some(isUntyped) && !isUnitLiteral(node)) {
      const target = checker.getContextualType(node);
      if (target) {
        for (const dst of present(target)) {
          const shape = recordShapeOf(dst);
          if (shape) markBuilt(shape, node, "untyped");
        }
      }
    }
    const sources: Array<{ type: ts.Type; cls: ObjectType | null; shape: string | null }> = [];
    for (const part of own) {
      const cls = programClassOf(part);
      const shape = cls ? null : recordShapeOf(part);
      if (cls || shape) sources.push({ type: part, cls, shape });
    }
    // An EMPTY literal (`options = {}`, `{} as Opts`) has no record shape of
    // its own to flow in, but it builds the record of the shape it fills.
    if (sources.length === 0 && ts.isObjectLiteralExpression(node) && node.properties.length === 0) {
      const filled = checker.getContextualType(node);
      if (filled) {
        for (const dst of present(filled)) {
          if (programClassOf(dst)) continue;
          const dstShape = recordShapeOf(dst);
          if (dstShape) markBuilt(dstShape, node, "empty-literal-into");
        }
      }
    }
    // Flows nested in arrays and record fields: an array of fresh records
    // (`xs.flatMap(x => [{ part: x, changed: x.onMove }])`) assigned to an
    // array of a wider record type is not an expression the checker gives a
    // contextual type per element, yet each class in a field is an arm of the
    // wider field's shape.
    {
      const nestedTarget = checker.getContextualType(node);
      if (nestedTarget) deepFlow(ownType, nestedTarget, 0);
    }
    if (sources.length === 0) return;
    const target = checker.getContextualType(node);
    if (!target) return;
    // An object literal (or one asserted to its type) is built as the shape
    // it flows into; it is a record of that shape, never an arm of it.
    let bare: ts.Expression = node;
    while (ts.isAsExpression(bare) || ts.isSatisfiesExpression(bare) || ts.isParenthesizedExpression(bare)) bare = bare.expression;
    const literal = ts.isObjectLiteralExpression(bare);
    for (const dst of present(target)) {
      if (programClassOf(dst)) continue;
      const dstShape = recordShapeOf(dst);
      if (!dstShape) continue;
      for (const src of sources) {
        if (src.shape === dstShape) continue;
        if (!checker.isTypeAssignableTo(src.type, dst)) {
          if (src.shape && node.parent && (ts.isAsExpression(node.parent) || ts.isTypeAssertion(node.parent)) &&
              node.parent.expression === node) {
            asserted.push({ from: src.shape, into: dstShape, dst });
          }
          continue;
        }
        if (src.cls) {
          const arms = classArms.get(dstShape) ?? new Map<string, ObjectType>();
          arms.set(src.cls.className, src.cls);
          classArms.set(dstShape, arms);
        } else if (src.shape) {
          // A literal whose get/set accessors stand for the destination's DATA
          // fields cannot be built as that shape (the slot would freeze one
          // answer): it stays its own record and flows in by reference, an arm.
          const dstFields = ctx.shapes.get(dstShape)?.fields ?? [];
          const accessorForData = literal && (ctx.shapes.get(src.shape)?.fields ?? []).some((f) => {
            const m = /^%[gs]et:(.+)$/.exec(f.name);
            return m !== null && dstFields.some((d) => d.name === m[1]);
          });
          if (literal && !accessorForData) {
            markBuilt(dstShape, node, "literal-into");
          } else {
            if (accessorForData) markBuilt(src.shape, node, "literal");
            const from = recordSources.get(dstShape) ?? new Set<string>();
            from.add(src.shape);
            recordSources.set(dstShape, from);
          }
        }
      }
    }
  };
  // The visit asks the checker for the type of every expression below: one batched request per chunk instead of one IPC
  // round trip per node (the per-node path was ~10 s of the scan on a large program).
  {
    const expressions: ts.Node[] = [];
    const collectExpressions = (node: ts.Node): void => {
      if (ts.isTypeNode(node)) return;
      if (ts.isExpression(node) && !ts.isParenthesizedExpression(node)) expressions.push(node);
      ts.forEachChild(node, collectExpressions);
    };
    for (const fp of parts) collectExpressions(fp.sf);
    checker.prefetchExpressionTypes(expressions);
    // record() asks every expression it visits for its contextual type (the nested flows deepFlow follows), one IPC per
    // node (~265k on a large program). One batched request per chunk instead; a prefetch only fills the memo the direct
    // queries read, and tsgo, which has no batch method, keeps the per-node queries.
    checker.prefetchContextualTypes(expressions);
    // The per-type queries the scan's mapping asks of each of those types (properties, signatures, index infos, ...),
    // pipelined into the checker's memo.
    const seenTypes: ts.Type[] = [];
    for (const node of expressions) {
      const own = checker.memoizedTypeAtLocation(node);
      if (own) seenTypes.push(own);
      const contextual = checker.memoizedContextualType(node);
      if (contextual) seenTypes.push(contextual);
    }
    checker.prefetchShapeQueries(seenTypes.flatMap((t) => (t.flags & ts.TypeFlags.Union) ? present(t) : [t]));
  }
  ica.phases["prefetch"] = Math.round(performance.now() - icaStart);
  const visitStart = performance.now();
  for (const fp of parts) visit(fp.sf);
  ica.phases["visit"] = Math.round(performance.now() - visitStart);
  const implementsStart = performance.now();

  // A class that `implements` a structural type flows into it: its instances
  // reach code typed by the interface through factories the checker types at
  // the interface (`device.createTexture()` is a GPUTexture to the caller, a
  // CoreGpuTexture to the class arm that answers it), so no expression of the
  // program shows the flow. Each class arm then carries its members' own
  // types into the shape's member types: a method's narrower return (or the
  // value its Promise settles with) and a property's narrower type are flows
  // too, to a fixed point.
  {
    const classDecls: ts.ClassLikeDeclaration[] = [];
    const collect = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) classDecls.push(node);
      ts.forEachChild(node, collect);
    };
    for (const fp of parts) collect(fp.sf);
    // A class the program extends is not seeded: an ancestor arm would fold
    // its subclasses' arms into it (the light classes behind LightBase), and
    // a downcast to a subclass's own interface would lose the subclass arm.
    // Its subclasses take part on their own flows.
    const extended = new Set<string>();
    for (const decl of classDecls) for (const name of ancestorsOf(decl)) extended.add(name);
    const pending: Array<{ shape: string; dst: ts.Type; cls: ObjectType }> = [];
    const addMemberArm = (dstShape: string, dst: ts.Type, cls: ObjectType): void => {
      if (extended.has(cls.className) || classArms.get(dstShape)?.has(cls.className)) return;
      addClassArm(dstShape, cls);
      pending.push({ shape: dstShape, dst, cls });
    };
    for (const decl of classDecls) {
      const clauses = decl.heritageClauses?.filter((c) => c.token === ts.SyntaxKind.ImplementsKeyword) ?? [];
      if (clauses.length === 0) continue;
      const symbol = decl.name ? checker.getSymbolAtLocation(decl.name) : undefined;
      if (!symbol) continue;
      let cls: ObjectType | null = null;
      try {
        cls = programClassOf(checker.getDeclaredTypeOfSymbol(symbol));
      } catch {
        cls = null;
      }
      if (!cls || genericInstanceOf.has(cls.className)) continue;
      for (const clause of clauses) {
        for (const ref of clause.types) {
          let dst: ts.Type;
          try {
            dst = checker.getTypeAtLocation(ref);
          } catch {
            continue;
          }
          if (programClassOf(dst)) continue;
          const dstShape = recordShapeOf(dst);
          if (dstShape) addMemberArm(dstShape, dst, cls);
        }
      }
    }
    // Contextual flows found by the walk take part too.
    for (const [shape, arms] of classArms) {
      const dst = typesOf.get(shape)?.[0];
      if (!dst) continue;
      for (const cls of arms.values()) if (!genericInstanceOf.has(cls.className)) pending.push({ shape, dst, cls });
    }
    const promised = (t: ts.Type): ts.Type | null => {
      if (t.getSymbol()?.name !== "Promise") return null;
      try {
        return checker.getTypeArguments(t as ts.TypeReference)[0] ?? null;
      } catch {
        return null;
      }
    };
    const memberFlow = (src: ts.Type, dst: ts.Type, depth: number): void => {
      if (depth > 3 || src === dst) return;
      for (const d of present(dst)) {
        for (const s of present(src)) {
          if (isUntyped(s) || isUntyped(d)) continue;
          const sp = promised(s), dp = promised(d);
          if (sp && dp) {
            memberFlow(sp, dp, depth + 1);
            continue;
          }
          const se = elementOf(s), de = elementOf(d);
          if (se && de) {
            memberFlow(se, de, depth + 1);
            continue;
          }
          const cls = programClassOf(s);
          if (!cls || genericInstanceOf.has(cls.className) || programClassOf(d)) continue;
          const dstShape = recordShapeOf(d);
          if (dstShape && checker.isTypeAssignableTo(s, d)) addMemberArm(dstShape, d, cls);
        }
      }
    };
    const returnOf = (t: ts.Type): ts.Type | null => {
      const sigs = checker.getCallSignatures(t);
      return sigs.length > 0 ? checker.getReturnTypeOfSignature(sigs[0]!) : null;
    };
    const seen = new Set<string>();
    for (let guard = 0; pending.length > 0 && guard < 100000; guard++) {
      const { shape, dst, cls } = pending.pop()!;
      const key = `${shape}\u0000${cls.className}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const instance = instanceOf.get(cls.className);
      if (!instance) continue;
      for (const prop of checker.getPropertiesOfType(dst)) {
        if (prop.name.startsWith("__@")) continue;
        const own = checker.getPropertyOfType(instance, prop.name);
        if (!own) continue;
        try {
          const ownType = checker.getTypeOfSymbol(own), dstType = checker.getTypeOfSymbol(prop);
          const ownReturn = returnOf(ownType), dstReturn = returnOf(dstType);
          if (ownReturn && dstReturn) memberFlow(ownReturn, dstReturn, 0);
          else if (!ownReturn && !dstReturn) memberFlow(ownType, dstType, 0);
        } catch {
          // a member type the checker API cannot answer for is no flow
        }
      }
    }
  }

  // TypeScript normalizes the object literals of a conditional, logical,
  // array or inferred-return expression into one union (`c ? { a, b } : { a }`
  // is `{ a; b } | { a; b?: undefined }`); the program builds each literal as
  // its normalized member, but the scan saw the literal at its own type. A
  // shape that is a built shape plus `?: undefined` slots is such a member, so
  // it is built too.
  {
    const undefinedSlot = (prop: ts.Symbol): boolean =>
      (prop.flags & ts.SymbolFlags.Optional) !== 0 && (checker.getTypeOfSymbol(prop).flags & ts.TypeFlags.Undefined) !== 0;
    const flowing = new Set<string>();
    for (const froms of recordSources.values()) for (const from of froms) flowing.add(from);
    for (const shape of flowing) {
      if (built.has(shape)) continue;
      const type = typesOf.get(shape)?.[0];
      if (!type) continue;
      const props = checker.getPropertiesOfType(type);
      const absent = props.filter(undefinedSlot);
      if (absent.length === 0) continue;
      const kept = props.filter((prop) => !undefinedSlot(prop));
      for (const other of [...built]) {
        const otherType = typesOf.get(other)?.[0];
        if (!otherType || other === shape) continue;
        const otherProps = checker.getPropertiesOfType(otherType);
        if (otherProps.length > props.length) continue;
        if (otherProps.every((prop) => checker.getPropertyOfType(type, prop.name)) &&
            props.every((prop) => checker.getPropertyOfType(otherType, prop.name) || undefinedSlot(prop)) &&
            kept.length > 0 && checker.isTypeAssignableTo(otherType, type)) {
          markBuilt(shape, parts[0]!.sf, "normalized-literal");
          break;
        }
      }
    }
  }

  // The shapes reaching a destination through value flows, transitively.
  const reaching = (dst: string): string[] => {
    const seen = new Set<string>([dst]);
    const pending = [dst];
    const found: string[] = [];
    while (pending.length > 0) {
      const at = pending.pop()!;
      for (const from of recordSources.get(at) ?? []) {
        if (seen.has(from)) continue;
        seen.add(from);
        pending.push(from);
        found.push(from);
      }
    }
    return found.sort();
  };
  for (const { from, into, dst } of asserted) {
    const fromArms = new Map<string, ObjectType>(classArms.get(from) ?? []);
    for (const up of reaching(from)) for (const [name, arm] of classArms.get(up) ?? []) fromArms.set(name, arm);
    for (const arm of fromArms.values()) {
      const instance = instanceOf.get(arm.className);
      if (!instance || !checker.isTypeAssignableTo(instance, dst)) continue;
      const arms = classArms.get(into) ?? new Map<string, ObjectType>();
      arms.set(arm.className, arm);
      classArms.set(into, arms);
    }
  }
  // The scan maps types for its own questions only; nothing it noted is a
  // finding about the program.
  lowerer.diags.length = diagsBefore;
  const entries = new Map<string, InterfaceArmsEntry>();
  for (const shapeId of new Set([...classArms.keys(), ...recordSources.keys()])) {
    const upstream = reaching(shapeId);
    // A shape's classes reach every shape it flows into.
    const arms = new Map<string, ObjectType>(classArms.get(shapeId) ?? []);
    for (const from of upstream) for (const [name, arm] of classArms.get(from) ?? []) arms.set(name, arm);
    // A subclass arm is already its ancestor's arm (upcast, and the
    // ancestor's methods dispatch virtually): keep the ancestor only.
    const kept = [...arms.values()].filter((arm) => {
      const decl = declOf.get(arm.className);
      return !decl || !ancestorsOf(decl).some((name) => arms.has(name));
    });
    const sources = upstream.filter((from) => built.has(from));
    // A source the program never builds as a literal still reaches the slot as a typed value (an
    // item entry arriving through a prop). It cannot be an arm (nothing builds it), so the shape's
    // own record stays an arm for it to copy into when other arms exist and would otherwise strand it.
    const copiedIn = sources.length > 0 && upstream.some((from) => !built.has(from));
    const plain = kept.filter((arm) => !genericInstanceOf.has(arm.className));
    const genericArms = kept.filter((arm) => genericInstanceOf.has(arm.className)).map((arm) => genericInstanceOf.get(arm.className)!);
    if (kept.length > 0 || sources.length > 0) entries.set(shapeId, { classArms: plain, genericArms, sources, record: built.has(shapeId) || copiedIn });
  }
  // A record flowing by value into wider shapes gets slots for their
  // optional fields it lacks, over every shape it reaches.
  const flowsInto = new Map<string, Set<string>>();
  for (const [dst, froms] of recordSources) {
    for (const from of froms) {
      const into = flowsInto.get(from) ?? new Set<string>();
      into.add(dst);
      flowsInto.set(from, into);
    }
  }
  const extraFields = new Map<string, Array<{ name: string; type: ts.Type }>>();
  for (const [from] of flowsInto) {
    const own = typesOf.get(from)?.[0];
    if (!own) continue;
    const seen = new Set<string>([from]);
    const pending = [from];
    const extras: Array<{ name: string; type: ts.Type }> = [];
    while (pending.length > 0) {
      const at = pending.pop()!;
      for (const dst of flowsInto.get(at) ?? []) {
        if (seen.has(dst)) continue;
        seen.add(dst);
        pending.push(dst);
        const wide = typesOf.get(dst)?.[0];
        if (!wide) continue;
        for (const prop of checker.getPropertiesOfType(wide)) {
          if ((prop.flags & ts.SymbolFlags.Optional) === 0 || prop.name.startsWith("__@")) continue;
          if (checker.getPropertyOfType(own, prop.name) || extras.some((e) => e.name === prop.name)) continue;
          extras.push({ name: prop.name, type: checker.getTypeOfSymbol(prop) });
        }
      }
    }
    if (extras.length > 0) extraFields.set(from, extras);
  }
  // A class arm likewise gets slots for the optional fields of the shapes it
  // stands in for: a write through the interface lands in the instance, and a
  // read across mixed arms finds the field on every arm.
  const classExtraFields = new Map<string, Array<{ name: string; type: ts.Type }>>();
  const genericExtraFields = new Map<string, Array<{ name: string; type: ts.Type }>>();
  for (const [shapeId, entry] of entries) {
    const wide = typesOf.get(shapeId)?.[0];
    if (!wide) continue;
    const genericStandIns = [...genericInstanceOf].filter(([, t]) => entry.genericArms.includes(t)).map(([name]) => name);
    for (const arm of [...entry.classArms, ...genericStandIns.map((className) => ({ kind: "object", className }) as ObjectType)]) {
      const instance = instanceOf.get(arm.className);
      if (!instance) continue;
      const generic = genericInstanceOf.has(arm.className);
      const key = generic ? lowerer.classNamer(declOf.get(arm.className)!) : arm.className;
      const into = generic ? genericExtraFields : classExtraFields;
      const extras = into.get(key) ?? [];
      for (const prop of checker.getPropertiesOfType(wide)) {
        if ((prop.flags & ts.SymbolFlags.Optional) === 0 || prop.name.startsWith("__@")) continue;
        if (checker.getPropertyOfType(instance, prop.name) || extras.some((e) => e.name === prop.name)) continue;
        extras.push({ name: prop.name, type: checker.getTypeOfSymbol(prop) });
      }
      if (extras.length > 0) into.set(key, extras);
    }
  }
  if (counting) {
    ica.phases["after visit"] = Math.round(performance.now() - implementsStart);
    ica.phases["total"] = Math.round(performance.now() - icaStart);
    console.error(`scriptc ica-counts ${JSON.stringify({ ...ica, checker: counting.report() })}`);
  }
  return { entries, typesOf, extraFields, classExtraFields, genericExtraFields, ctx };
}
