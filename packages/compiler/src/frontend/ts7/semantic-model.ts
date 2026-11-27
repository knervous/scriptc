// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import type { SemanticSignatureData as SignatureResponse, SemanticSymbolData as SymbolResponse, SemanticTypeData as TypeResponse } from "./semantic-schema.generated.js";
import { AstNode } from "./ast-node.js";
import { parseAstNodeHandle } from "./ast-wire.js";
import type { SemanticChecker, SemanticJsDocTag } from "./semantic-checker.js";
import { decodeSemanticObject, decodeSemanticObjects, parseSemanticJson } from "./semantic-json.js";
import { SemanticObjectFlags as ObjectFlags, SemanticSignatureFlags as SignatureFlags, SemanticTypeFlags as TypeFlags } from "./semantic-schema.generated.js";

/** JSON and binary operations stay at the transport boundary. The concrete
 * semantic objects below need neither the SDK nor a JavaScript engine. */
/** The elements of a reply that has no nulls: a null element fails as it
 * would when read as an object. */
export function present<T>(items: (T | undefined)[], method: string): T[] {
  for (const item of items)
    if (item === undefined) throw new TypeError(`${method} returned a null element`);
  return items as T[];
}

export interface SemanticTransport {
  text: (method: string, payload: string) => string;
  binary: (method: string, payload: string) => Uint8Array;
  /** Pipelined checker queries (optional: a transport without it answers them one by one). */
  binaryPipelined?: (requests: readonly { method: string; json: string }[]) => (Uint8Array | Error)[];
}

/** How a pipelined reply is read: as the matching request* method would read it. */
export type SemanticReplyKind = "symbols" | "signatures" | "types" | "json";

export type SemanticDocument = string | { uri: string };

/** The pinned checker protocol's request fields. A single concrete record
 * keeps generic response decoding independent of structural object spread. */
export interface SemanticQuery {
  snapshot?: number | undefined;
  project?: string | undefined;
  objectId?: number | undefined;
  location?: string | undefined;
  locations?: string[] | undefined;
  file?: SemanticDocument | undefined;
  position?: number | undefined;
  positions?: readonly number[] | undefined;
  type?: number | undefined;
  symbol?: number | undefined;
  symbols?: number[] | undefined;
  signature?: number | undefined;
  source?: number | undefined;
  target?: number | undefined;
  kind?: number | undefined;
  name?: string | undefined;
  flags?: number | undefined;
  meaning?: number | undefined;
  excludeGlobals?: boolean | undefined;
  index?: number | undefined;
  node?: string | undefined;
  signatureDecl?: string | undefined;
  triggerCharacter?: string | undefined;
  includeSymbol?: boolean | undefined;
}

export class SemanticProgram {
  constructor(private readonly sourceFile: (path: string) => AstNode | undefined) {}
  getSourceFile(path: string): AstNode | undefined { return this.sourceFile(path); }
}

/** Symbols are snapshot-wide; TypeScript type and signature handles are
 * project-local. Preserve both scopes even when numeric handles coincide. */
export class SemanticSnapshot {
  private readonly projects = new Map<string, SemanticProject>();
  private readonly symbols = new Map<number, SemanticSymbol>();
  private disposed = false;

  constructor(readonly id: number, readonly transport: SemanticTransport) {}

  addProject(id: string, sourceFile: (path: string) => AstNode | undefined): SemanticProject {
    this.ensureActive();
    if (this.projects.has(id)) throw new Error(`Duplicate TypeScript project ${id}`);
    const project = new SemanticProject(id, this, new SemanticProgram(sourceFile));
    this.projects.set(id, project);
    return project;
  }

  getProject(id: string): SemanticProject {
    this.ensureActive();
    const project = this.projects.get(id);
    if (project === undefined) throw new Error(`Unknown TypeScript canonical project ${id}`);
    return project;
  }

  symbol(data: SymbolResponse): SemanticSymbol {
    this.ensureActive();
    let symbol = this.symbols.get(data.id);
    if (symbol === undefined) {
      symbol = new SemanticSymbol(data, this.getProject(data.project));
      this.symbols.set(data.id, symbol);
    }
    return symbol;
  }

  cachedSymbol(id: number): SemanticSymbol | undefined {
    this.ensureActive();
    return this.symbols.get(id);
  }

  ensureActive(): void {
    if (this.disposed) throw new Error("TypeScript semantic snapshot is disposed");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const project of this.projects.values()) project.dispose();
    this.projects.clear();
    for (const symbol of this.symbols.values()) symbol.dispose();
    this.symbols.clear();
  }
}

export class SemanticProject {
  private readonly types = new Map<number, SemanticType>();
  private readonly signatures = new Map<number, SemanticSignature>();
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;

  constructor(readonly id: string, readonly snapshot: SemanticSnapshot, readonly program: SemanticProgram) {}

  ensureActive(): void {
    this.snapshot.ensureActive();
    if (this.disposed) throw new Error("TypeScript semantic project is disposed");
  }

  /** Project-local consumers register cleanup without adding a global root.
   * Registration after disposal is rejected just like semantic queries. */
  onDispose(cleanup: () => void): void {
    this.ensureActive();
    this.cleanups.push(cleanup);
  }

  request<T>(method: string, query: SemanticQuery = {}): T {
    this.ensureActive();
    query.snapshot = this.snapshot.id;
    query.project = this.id;
    if (rpcStats !== null) return rpcStats.measure(method, () => parseSemanticJson<T>(this.snapshot.transport.text(method, JSON.stringify(query))));
    return parseSemanticJson<T>(this.snapshot.transport.text(method, JSON.stringify(query)));
  }

  requestBinary(method: string, query: SemanticQuery): Uint8Array {
    this.ensureActive();
    query.snapshot = this.snapshot.id;
    query.project = this.id;
    if (rpcStats !== null) return rpcStats.measure(method, () => this.snapshot.transport.binary(method, JSON.stringify(query)));
    return this.snapshot.transport.binary(method, JSON.stringify(query));
  }

  /** Several queries in one pipelined exchange, each reply read as `kind` (requestSymbols, requestSignatures,
   * requestTypes, request); a reply the server refused is its Error. */
  requestPipelined(requests: readonly { method: string; query: SemanticQuery; kind: SemanticReplyKind }[]): unknown[] {
    this.ensureActive();
    const json = requests.map(({ method, query }) => {
      query.snapshot = this.snapshot.id;
      query.project = this.id;
      return { method, json: JSON.stringify(query) };
    });
    const transport = this.snapshot.transport;
    const replies = transport.binaryPipelined
      ? (rpcStats !== null ? rpcStats.measure(`pipelined x${requests.length}`, () => transport.binaryPipelined!(json)) : transport.binaryPipelined(json))
      : json.map(({ method, json: payload }) => { try { return transport.binary(method, payload); } catch (error) { return error instanceof Error ? error : new Error(String(error)); } });
    return replies.map((bytes, i) => (bytes instanceof Error ? bytes : this.decodeReply(requests[i]!.kind, bytes)));
  }

  private decodeReply(kind: SemanticReplyKind, bytes: Uint8Array): unknown {
    if (kind === "json") return parseSemanticJson(bytes.length === 0 ? "null" : Buffer.from(bytes).toString("utf8"));
    if (kind === "types") return (decodeSemanticObjects(bytes, (id: number) => this.types.get(id), (data: TypeResponse) => this.type(data)) ?? []).map((item) => item ?? undefined);
    if (kind === "symbols") return (decodeSemanticObjects(bytes, (id: number) => this.snapshot.cachedSymbol(id), (data: SymbolResponse) => this.symbol(data)) ?? []).map((item) => item ?? undefined);
    return (decodeSemanticObjects(bytes, (id: number) => this.signatures.get(id), (data: SignatureResponse) => this.signature(data)) ?? []).map((item) => item ?? undefined);
  }

  /** A reply of one type, or undefined for null. */
  requestType(method: string, query: SemanticQuery): SemanticType | undefined {
    const bytes = this.requestBinary(method, query);
    const cached = (id: number): SemanticType | undefined => this.types.get(id);
    const build = (data: TypeResponse): SemanticType => this.type(data);
    return decodeSemanticObject(bytes, cached, build) ?? undefined;
  }

  /** A reply of types and nulls (undefined here), or [] for null. */
  requestTypes(method: string, query: SemanticQuery): (SemanticType | undefined)[] {
    const bytes = this.requestBinary(method, query);
    const cached = (id: number): SemanticType | undefined => this.types.get(id);
    const build = (data: TypeResponse): SemanticType => this.type(data);
    return (decodeSemanticObjects(bytes, cached, build) ?? []).map((item) => item ?? undefined);
  }

  /** A reply of one symbol, or undefined for null. */
  requestSymbol(method: string, query: SemanticQuery): SemanticSymbol | undefined {
    const bytes = this.requestBinary(method, query);
    const cached = (id: number): SemanticSymbol | undefined => this.snapshot.cachedSymbol(id);
    const build = (data: SymbolResponse): SemanticSymbol => this.symbol(data);
    return decodeSemanticObject(bytes, cached, build) ?? undefined;
  }

  /** A reply of symbols and nulls (undefined here), or [] for null. */
  requestSymbols(method: string, query: SemanticQuery): (SemanticSymbol | undefined)[] {
    const bytes = this.requestBinary(method, query);
    const cached = (id: number): SemanticSymbol | undefined => this.snapshot.cachedSymbol(id);
    const build = (data: SymbolResponse): SemanticSymbol => this.symbol(data);
    return (decodeSemanticObjects(bytes, cached, build) ?? []).map((item) => item ?? undefined);
  }

  /** A reply of one signature, or undefined for null. */
  requestSignature(method: string, query: SemanticQuery): SemanticSignature | undefined {
    const bytes = this.requestBinary(method, query);
    const cached = (id: number): SemanticSignature | undefined => this.signatures.get(id);
    const build = (data: SignatureResponse): SemanticSignature => this.signature(data);
    return decodeSemanticObject(bytes, cached, build) ?? undefined;
  }

  /** A reply of signatures and nulls (undefined here), or [] for null. */
  requestSignatures(method: string, query: SemanticQuery): (SemanticSignature | undefined)[] {
    const bytes = this.requestBinary(method, query);
    const cached = (id: number): SemanticSignature | undefined => this.signatures.get(id);
    const build = (data: SignatureResponse): SemanticSignature => this.signature(data);
    return (decodeSemanticObjects(bytes, cached, build) ?? []).map((item) => item ?? undefined);
  }

  type(data: TypeResponse): SemanticType {
    this.ensureActive();
    let type = this.types.get(data.id);
    if (type === undefined) {
      type = new SemanticType(data, this);
      this.types.set(data.id, type);
    }
    return type;
  }

  signature(data: SignatureResponse): SemanticSignature {
    this.ensureActive();
    let signature = this.signatures.get(data.id);
    if (signature === undefined) {
      signature = new SemanticSignature(data, this);
      this.signatures.set(data.id, signature);
    }
    return signature;
  }

  symbol(data: SymbolResponse): SemanticSymbol {
    this.ensureActive();
    return this.snapshot.symbol(data);
  }

  fetchType(source: number, method: string, handle: number | undefined | false): SemanticType | undefined {
    this.ensureActive();
    if (handle !== false) {
      if (handle === undefined || handle === 0) return undefined;
      const cached = this.types.get(handle);
      if (cached !== undefined) return cached;
    }
    const type = this.requestType(method, { objectId: source });
    if (type === undefined) throw new Error(`${method} returned null type for ${source}`);
    return type;
  }

  fetchSymbol(source: number, method: string, handle: number | undefined): SemanticSymbol | undefined {
    this.ensureActive();
    if (handle === undefined || handle === 0) return undefined;
    const cached = this.snapshot.cachedSymbol(handle);
    if (cached !== undefined) return cached;
    const symbol = this.requestSymbol(method, { objectId: source });
    if (symbol === undefined) throw new Error(`${method} returned null symbol for ${source}`);
    return symbol;
  }

  fetchSignature(source: number, method: string, handle: number | undefined): SemanticSignature | undefined {
    this.ensureActive();
    if (handle === undefined || handle === 0) return undefined;
    const cached = this.signatures.get(handle);
    if (cached !== undefined) return cached;
    const signature = this.requestSignature(method, { objectId: source });
    if (signature === undefined) throw new Error(`${method} returned null signature for ${source}`);
    return signature;
  }

  fetchTypes(source: number, method: string, handles?: readonly number[]): SemanticType[] {
    this.ensureActive();
    if (handles !== undefined) {
      const cached: SemanticType[] = [];
      for (const id of handles) {
        const type = this.types.get(id);
        if (type === undefined) break;
        cached.push(type);
      }
      if (cached.length === handles.length) return cached;
    }
    return present(this.requestTypes(method, { objectId: source }), method);
  }

  fetchSymbols(source: number, method: string, handles?: readonly number[]): SemanticSymbol[] {
    this.ensureActive();
    if (handles !== undefined) {
      const cached: SemanticSymbol[] = [];
      for (const id of handles) {
        const symbol = this.snapshot.cachedSymbol(id);
        if (symbol === undefined) break;
        cached.push(symbol);
      }
      if (cached.length === handles.length) return cached;
    }
    return present(this.requestSymbols(method, { objectId: source }), method);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const type of this.types.values()) type.dispose();
    this.types.clear();
    this.signatures.clear();
    // Detach before invoking callbacks so reentrant disposal is harmless.
    const cleanups = this.cleanups.slice();
    this.cleanups.length = 0;
    for (const cleanup of cleanups) cleanup();
  }
}

/** A handle records its producing project, so declaration resolution is
 * unambiguous even when a symbol is reused by a second project's checker. */
export class SemanticNodeHandle {
  readonly index: number;
  readonly kind: number;
  readonly path: string;

  constructor(readonly handle: string, readonly canonicalProject: SemanticProject) {
    const parsed = parseAstNodeHandle(handle);
    this.index = parsed.index;
    this.kind = parsed.kind;
    this.path = parsed.path;
  }

  resolve(project: SemanticProject = this.canonicalProject): AstNode | undefined {
    this.canonicalProject.ensureActive();
    const file = project.program.getSourceFile(this.path);
    return file?.file.resolve(this.handle);
  }
}

export class SemanticSymbol {
  readonly id: number;
  readonly escapedName: string;
  readonly name: string;
  readonly flags: number;
  readonly checkFlags: number;
  readonly declarations: SemanticNodeHandle[];
  readonly valueDeclaration: SemanticNodeHandle | undefined;
  private readonly parent: number | undefined;
  private readonly exportSymbol: number | undefined;
  private membersCache: Map<string, SemanticSymbol> | undefined;
  private exportsCache: Map<string, SemanticSymbol> | undefined;

  constructor(data: SymbolResponse, readonly canonicalProject: SemanticProject) {
    this.id = data.id;
    this.escapedName = data.name;
    this.name = data.name.startsWith("___") ? data.name.slice(1) : data.name;
    this.flags = data.flags;
    this.checkFlags = data.checkFlags;
    this.declarations = (data.declarations ?? []).map((handle) => new SemanticNodeHandle(handle, canonicalProject));
    this.valueDeclaration = data.valueDeclaration ? new SemanticNodeHandle(data.valueDeclaration, canonicalProject) : undefined;
    this.parent = data.parent;
    this.exportSymbol = data.exportSymbol;
  }

  getParent(): SemanticSymbol | undefined {
    return this.canonicalProject.fetchSymbol(this.id, "getParentOfSymbol", this.parent);
  }
  getExportSymbol(): SemanticSymbol {
    this.canonicalProject.ensureActive();
    if (this.exportSymbol === undefined || this.exportSymbol === 0) return this;
    const result = this.canonicalProject.fetchSymbol(this.id, "getExportSymbolOfSymbol", this.exportSymbol);
    if (result === undefined) throw new Error(`Missing export symbol for ${this.id}`);
    return result;
  }
  private table(method: string): Map<string, SemanticSymbol> {
    const table = new Map<string, SemanticSymbol>();
    for (const symbol of this.canonicalProject.fetchSymbols(this.id, method)) table.set(symbol.escapedName, symbol);
    return table;
  }
  getMembers(): Map<string, SemanticSymbol> {
    this.canonicalProject.ensureActive();
    if (this.membersCache === undefined) this.membersCache = this.table("getMembersOfSymbol");
    return this.membersCache;
  }
  getExports(): Map<string, SemanticSymbol> {
    this.canonicalProject.ensureActive();
    if (this.exportsCache === undefined) this.exportsCache = this.table("getExportsOfSymbol");
    return this.exportsCache;
  }
  dispose(): void {
    this.membersCache?.clear();
    this.exportsCache?.clear();
    this.membersCache = undefined;
    this.exportsCache = undefined;
  }
  getJsDocTags(checker: SemanticChecker): SemanticJsDocTag[] { return checker.getJsDocTagsOfSymbol(this); }
  getDocumentationComment(checker: SemanticChecker): string { return checker.getDocumentationCommentOfSymbol(this); }
}

/** Type refinements keep the same native object, including its project and
 * lazy handle caches. Narrowed fields are read from their original storage. */
export interface SemanticObjectType extends SemanticType { readonly objectFlags: number; }
export interface SemanticIntrinsicType extends SemanticType { readonly intrinsicName: string; }
export interface SemanticLiteralType extends SemanticType { readonly value: string | number | boolean | bigint; }
export interface SemanticStringLiteralType extends SemanticLiteralType { readonly value: string; }
export interface SemanticNumberLiteralType extends SemanticLiteralType { readonly value: number; }
export interface SemanticBigIntLiteralType extends SemanticLiteralType { readonly value: bigint; }
export interface SemanticBooleanLiteralType extends SemanticLiteralType { readonly value: boolean; }
export interface SemanticTupleType extends SemanticObjectType {
  readonly elementFlags: number[];
  readonly fixedLength: number;
  readonly readonly: boolean;
}

/** Kind-specific accessors share one nominal layout. */
export class SemanticType {
  readonly id: number;
  readonly flags: number;
  readonly objectFlags: number | undefined;
  readonly value: string | number | boolean | bigint | undefined;
  readonly intrinsicName: string | undefined;
  readonly isThisType: boolean | undefined;
  readonly elementFlags: number[] | undefined;
  readonly fixedLength: number | undefined;
  readonly readonly: boolean | undefined;
  readonly texts: string[] | undefined;
  private trueType: number | false = false;
  private falseType: number | false = false;
  private constituents: SemanticType[] | undefined;

  constructor(private readonly data: TypeResponse, readonly project: SemanticProject) {
    this.id = data.id;
    this.flags = data.flags;
    this.objectFlags = data.objectFlags;
    const value = data.value;
    if ((data.flags & TypeFlags.BigIntLiteral) !== 0 && value != null) {
      if (typeof value !== "string") throw new Error("TypeScript bigint literal is not a decimal string");
      this.value = BigInt(value);
    } else {
      this.value = value ?? undefined;
    }
    this.intrinsicName = data.intrinsicName;
    this.isThisType = data.isThisType;
    this.elementFlags = data.elementFlags;
    this.fixedLength = data.fixedLength;
    this.readonly = data.readonly;
    this.texts = data.texts;
  }

  getSymbol(): SemanticSymbol | undefined { return this.project.fetchSymbol(this.id, "getSymbolOfType", this.data.symbol); }
  getAliasSymbol(): SemanticSymbol | undefined { return this.project.fetchSymbol(this.id, "getAliasSymbolOfType", this.data.aliasSymbol); }
  getTarget(): SemanticType | undefined { return this.project.fetchType(this.id, "getTargetOfType", this.data.target); }
  getFreshType(): SemanticType | undefined { return this.project.fetchType(this.id, "getFreshTypeOfType", this.data.freshType); }
  getRegularType(): SemanticType | undefined { return this.project.fetchType(this.id, "getRegularTypeOfType", this.data.regularType); }
  getObjectType(): SemanticType | undefined { return this.project.fetchType(this.id, "getObjectTypeOfType", this.data.objectType); }
  getIndexType(): SemanticType | undefined { return this.project.fetchType(this.id, "getIndexTypeOfType", this.data.indexType); }
  getCheckType(): SemanticType | undefined { return this.project.fetchType(this.id, "getCheckTypeOfType", this.data.checkType); }
  getExtendsType(): SemanticType | undefined { return this.project.fetchType(this.id, "getExtendsTypeOfType", this.data.extendsType); }
  getBaseType(): SemanticType | undefined { return this.project.fetchType(this.id, "getBaseTypeOfType", this.data.baseType); }
  getConstraint(): SemanticType | undefined { return this.project.fetchType(this.id, "getConstraintOfType", this.data.substConstraint); }
  getTypeParameters(): SemanticType[] { return this.project.fetchTypes(this.id, "getTypeParametersOfType", this.data.typeParameters ?? []); }
  getOuterTypeParameters(): SemanticType[] { return this.project.fetchTypes(this.id, "getOuterTypeParametersOfType", this.data.outerTypeParameters ?? []); }
  getLocalTypeParameters(): SemanticType[] { return this.project.fetchTypes(this.id, "getLocalTypeParametersOfType", this.data.localTypeParameters ?? []); }
  getAliasTypeArguments(): SemanticType[] { return this.project.fetchTypes(this.id, "getAliasTypeArgumentsOfType", this.data.aliasTypeArguments ?? []); }
  getTypes(): SemanticType[] | undefined {
    this.project.ensureActive();
    if ((this.flags & (TypeFlags.UnionOrIntersection | TypeFlags.TemplateLiteral)) === 0) return undefined;
    if (this.constituents === undefined) this.constituents = this.project.fetchTypes(this.id, "getTypesOfType");
    return this.constituents;
  }
  dispose(): void { this.constituents = undefined; }
  getBaseTypes(): SemanticType[] | undefined {
    this.project.ensureActive();
    if (!this.isClassOrInterface()) return undefined;
    return present(this.project.requestTypes("getBaseTypes", { type: this.id }), "getBaseTypes");
  }
  getTrueType(): SemanticType {
    const result = this.project.fetchType(this.id, "getTrueTypeOfConditionalType", this.trueType);
    if (result === undefined) throw new Error(`Missing conditional true type for ${this.id}`);
    this.trueType = result.id;
    return result;
  }
  getFalseType(): SemanticType {
    const result = this.project.fetchType(this.id, "getFalseTypeOfConditionalType", this.falseType);
    if (result === undefined) throw new Error(`Missing conditional false type for ${this.id}`);
    this.falseType = result.id;
    return result;
  }
  isClassOrInterface(): boolean { return this.isObjectType() && ((this.objectFlags ?? 0) & ObjectFlags.ClassOrInterface) !== 0; }
  isUnionType(): boolean { return (this.flags & TypeFlags.Union) !== 0; }
  isIntersectionType(): boolean { return (this.flags & TypeFlags.Intersection) !== 0; }
  isObjectType(): this is SemanticObjectType { return (this.flags & TypeFlags.Object) !== 0; }
  isIntrinsicType(): this is SemanticIntrinsicType { return (this.flags & TypeFlags.Intrinsic) !== 0; }
  isErrorType(): boolean { return this.isIntrinsicType() && this.intrinsicName === "error"; }
  isLiteralType(): this is SemanticLiteralType { return (this.flags & TypeFlags.Literal) !== 0; }
  isStringLiteralType(): this is SemanticStringLiteralType { return (this.flags & TypeFlags.StringLiteral) !== 0; }
  isNumberLiteralType(): this is SemanticNumberLiteralType { return (this.flags & TypeFlags.NumberLiteral) !== 0; }
  isBigIntLiteralType(): this is SemanticBigIntLiteralType { return (this.flags & TypeFlags.BigIntLiteral) !== 0; }
  isBooleanLiteralType(): this is SemanticBooleanLiteralType { return (this.flags & TypeFlags.BooleanLiteral) !== 0; }
  isTypeReference(): boolean { return this.isObjectType() && ((this.objectFlags ?? 0) & ObjectFlags.Reference) !== 0; }
  isTupleType(): boolean { return this.isObjectType() && ((this.objectFlags ?? 0) & ObjectFlags.Tuple) !== 0; }
  isIndexType(): boolean { return (this.flags & TypeFlags.Index) !== 0; }
  isIndexedAccessType(): boolean { return (this.flags & TypeFlags.IndexedAccess) !== 0; }
  isConditionalType(): boolean { return (this.flags & TypeFlags.Conditional) !== 0; }
  isSubstitutionType(): boolean { return (this.flags & TypeFlags.Substitution) !== 0; }
  isTemplateLiteralType(): boolean { return (this.flags & TypeFlags.TemplateLiteral) !== 0; }
  isStringMappingType(): boolean { return (this.flags & TypeFlags.StringMapping) !== 0; }
  isTypeParameter(): boolean { return (this.flags & TypeFlags.TypeParameter) !== 0; }
}

export class SemanticSignature {
  readonly id: number;
  readonly flags: number;
  readonly declaration: SemanticNodeHandle | undefined;

  constructor(private readonly data: SignatureResponse, readonly project: SemanticProject) {
    this.id = data.id;
    this.flags = data.flags;
    this.declaration = data.declaration ? new SemanticNodeHandle(data.declaration, project) : undefined;
  }

  getTypeParameters(): SemanticType[] { return this.project.fetchTypes(this.id, "getTypeParametersOfSignature", this.data.typeParameters ?? []); }
  getParameters(): SemanticSymbol[] { return this.project.fetchSymbols(this.id, "getParametersOfSignature", this.data.parameters ?? []); }
  getThisParameter(): SemanticSymbol | undefined { return this.project.fetchSymbol(this.id, "getThisParameterOfSignature", this.data.thisParameter); }
  getTarget(): SemanticSignature | undefined { return this.project.fetchSignature(this.id, "getTargetOfSignature", this.data.target); }
  get hasRestParameter(): boolean { return (this.flags & SignatureFlags.HasRestParameter) !== 0; }
  get isConstruct(): boolean { return (this.flags & SignatureFlags.Construct) !== 0; }
  get isAbstract(): boolean { return (this.flags & SignatureFlags.Abstract) !== 0; }
}

/** SCRIPTC_RPC_STATS=1: per request kind and per compiler call site (first stack frame outside ts7/), the count and the
 * wall time of each tsgo request, printed to stderr at exit. Off by default; costs one stack capture per request. */
class RpcStats {
  private readonly byMethod = new Map<string, { n: number; ms: number }>();
  private readonly bySite = new Map<string, { n: number; ms: number }>();
  constructor() { process.on("exit", () => this.print()); }
  measure<T>(method: string, run: () => T): T {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 30;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = limit;
    const frames = stack.split("\n").slice(2);
    const site = frames.find((f) => !/\/ts7\/(semantic|checker|session|rpc)|node:internal/.test(f)) ?? frames[0] ?? "?";
    const at = site.trim().replace(/^at /, "").replace(/\(?file:\/\/.*?\/dist\//, "(");
    const started = performance.now();
    try { return run(); } finally {
      const ms = performance.now() - started;
      for (const [map, key] of [[this.byMethod, method], [this.bySite, `${method} <- ${at}`]] as const) {
        const entry = map.get(key) ?? { n: 0, ms: 0 };
        entry.n++; entry.ms += ms; map.set(key, entry);
      }
    }
  }
  print(): void {
    const rows = (map: Map<string, { n: number; ms: number }>, limit: number): string =>
      [...map].sort((a, b) => b[1].ms - a[1].ms).slice(0, limit).map(([k, v]) => `${(v.ms / 1000).toFixed(2).padStart(7)} s ${String(v.n).padStart(8)} calls  ${k}`).join("\n");
    process.stderr.write(`scriptc rpc by method\n${rows(this.byMethod, 40)}\nscriptc rpc by site\n${rows(this.bySite, 60)}\n`);
  }
}
const rpcStats: RpcStats | null = process.env["SCRIPTC_RPC_STATS"] === "1" ? new RpcStats() : null;
