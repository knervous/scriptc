// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { AstDecodeError } from "./ast-bytes.js";
import { AstKind, AstModifierFlags, AstNodeFlags, KIND_NODE_LIST, astChildOrder } from "./ast-schema.generated.js";
import { astLineOfPosition, astLineStarts, astSkipTrivia } from "./ast-text.js";
import { AstWireFile, PREORDER_LIST, parseAstNodeHandle, type AstFileReference } from "./ast-wire.js";
import type { SourceFile } from "./ast-types.js";
import { SyntaxKind, NodeFlags } from "./enums.js";

/** One immutable AST response owns one object per node and one array per
 * list. Parent access is lazy, so resolving a checker handle near the bottom
 * of a deep tree never recursively constructs its ancestors. */
export class AstFile {
  readonly wire: AstWireFile;
  readonly root: AstNode;
  // Wire ids are bounded dense indices. Direct slots preserve lazy object
  // creation and avoid hashing and temporary optional boxes on every read.
  private readonly nodes: (AstNode | undefined)[];
  private readonly lists: (AstNode[] | undefined)[];
  private readonly references = new Map<number, AstFileReference[]>();
  private readonly structuredNodes = new Map<number, AstNode[]>();
  private readonly strings = new Map<number, string[]>();
  private lines: number[] | undefined;
  private childIndices: Uint32Array | undefined;

  constructor(
    bytes: Uint8Array,
    private readonly listMetadata?: (nodes: AstNode[], pos: number, end: number) => void,
    private readonly materialized?: () => void,
  ) {
    this.wire = new AstWireFile(bytes);
    this.nodes = new Array<AstNode | undefined>(this.wire.nodeCount);
    this.lists = new Array<AstNode[] | undefined>(this.wire.nodeCount);
    this.root = new AstNode(this, 1);
    this.nodes[1] = this.root;
  }

  /** Checker factories also return AST fragments. Only source-file
   * consumers require this kind check; a type or signature root is valid
   * for typeToTypeNode/signatureToSignatureDeclaration. */
  get sourceFile(): SourceFile {
    if (this.root.kind !== SyntaxKind.SourceFile) throw new AstDecodeError("expected a source file root");
    return this.root as SourceFile;
  }

  node(index: number): AstNode {
    const existing = this.nodes[index];
    if (existing !== undefined) return existing;
    if (index === 0 || this.wire.kind(index) === KIND_NODE_LIST) throw new AstDecodeError("expected a node index");
    const node = new AstNode(this, index);
    this.nodes[index] = node;
    this.materialized?.();
    return node;
  }

  list(index: number): AstNode[] {
    const existing = this.lists[index];
    if (existing !== undefined) return existing;
    const nodes: AstNode[] = [];
    for (const child of this.wire.list(index)) nodes.push(this.node(child));
    this.listMetadata?.(nodes, this.wire.pos(index) >>> 0, this.wire.end(index) >>> 0);
    this.lists[index] = nodes;
    this.materialized?.();
    return nodes;
  }

  namedChild(node: AstNode, name: string): number {
    return this.namedChildAt(node, astChildOrder(node.kind, name));
  }

  /** The child in wire slot `order` (astChildOrder), or 0 when the slot is negative or empty. */
  namedChildAt(node: AstNode, order: number): number {
    if (node.file !== this) throw new AstDecodeError("named child belongs to another source file");
    if (order < 0) return 0;
    const mask = (node.data >>> 30) === 0 ? node.data & 0xff : 0xff;
    if ((mask & (1 << order)) === 0) return 0;
    const slot = node.index * 8 + order;
    const indices = this.childIndices;
    if (indices !== undefined) {
      const cached = indices[slot]!;
      if (cached !== 0) return cached;
    }
    const index = this.wire.childAtOrder(node.index, order);
    // The pinned wire has at most eight named children per node. One packed
    // table avoids per-node arrays; allocate it only after successful access
    // so malformed siblings still fail lazily in the checked wire decoder.
    if (this.childIndices === undefined) this.childIndices = new Uint32Array(this.wire.nodeCount * 8);
    this.childIndices[slot] = index;
    return index;
  }

  resolve(handle: string): AstNode {
    const parsed = parseAstNodeHandle(handle);
    if (parsed.path !== this.root.path) throw new AstDecodeError("node handle belongs to another source file");
    const node = this.node(parsed.index);
    if (node.kind !== parsed.kind) throw new AstDecodeError("node handle kind does not match the response");
    return node;
  }

  fileReferences(offset: number): AstFileReference[] {
    let result = this.references.get(offset);
    if (result === undefined) {
      result = this.wire.fileReferences(offset);
      this.references.set(offset, result);
    }
    return result;
  }

  nodeReferences(offset: number): AstNode[] {
    let result = this.structuredNodes.get(offset);
    if (result === undefined) {
      result = [];
      for (const index of this.wire.nodeIndices(offset)) result.push(this.node(index));
      this.structuredNodes.set(offset, result);
    }
    return result;
  }

  stringReferences(offset: number): string[] {
    let result = this.strings.get(offset);
    if (result === undefined) {
      result = this.wire.stringArray(offset);
      this.strings.set(offset, result);
    }
    return result;
  }

  lineStarts(): number[] {
    if (this.lines === undefined) this.lines = astLineStarts(this.root.text ?? "");
    return this.lines;
  }
}

/** Concrete native layout shared by every syntax kind. Kind-specific
 * properties are views over the wire; they never copy identity-bearing
 * nodes into structural records. */
export class AstNode {
  readonly kind: SyntaxKind;
  readonly pos: number;
  readonly end: number;
  readonly flags: NodeFlags;
  readonly data: number;
  private parentResolved = false;
  private parentCache: AstNode | undefined;

  constructor(readonly file: AstFile, readonly index: number) {
    // Materialize immutable scalar metadata once. Lowering repeatedly reads
    // it while refining the same node, without needing another wire decode.
    const wire = file.wire;
    this.kind = wire.kind(index);
    this.pos = wire.pos(index);
    this.end = wire.end(index);
    this.flags = wire.flags(index);
    this.data = wire.data(index);
  }

  get id(): string { return `${this.index}.${this.kind}.${this.file.root.path}`; }
  get parent(): AstNode | undefined {
    if (!this.parentResolved) {
      const index = this.file.wire.semanticParent(this.index);
      this.parentCache = index === 0 || index === this.index ? undefined : this.file.node(index);
      this.parentResolved = true;
    }
    return this.parentCache;
  }
  get text(): string | undefined { return this.file.wire.text(this.index); }
  get rawText(): string | undefined { return this.file.wire.rawText(this.index); }

  childNode(name: string): AstNode | undefined {
    const index = this.file.namedChild(this, name);
    return index === 0 ? undefined : this.file.node(index);
  }
  /** childNode by wire slot, as the generated getters select it. */
  childNodeAt(order: number): AstNode | undefined {
    const index = this.file.namedChildAt(this, order);
    return index === 0 ? undefined : this.file.node(index);
  }
  childListAt(order: number): AstNode[] | undefined {
    const index = this.file.namedChildAt(this, order);
    return index === 0 ? undefined : this.file.list(index);
  }
  childAt(order: number): AstNode | AstNode[] | undefined {
    const index = this.file.namedChildAt(this, order);
    if (index === 0) return undefined;
    return this.file.wire.kind(index) === KIND_NODE_LIST ? this.file.list(index) : this.file.node(index);
  }
  childList(name: string): AstNode[] | undefined {
    const index = this.file.namedChild(this, name);
    return index === 0 ? undefined : this.file.list(index);
  }
  child(name: string): AstNode | AstNode[] | undefined {
    const index = this.file.namedChild(this, name);
    if (index === 0) return undefined;
    return this.file.wire.kind(index) === KIND_NODE_LIST ? this.file.list(index) : this.file.node(index);
  }

  forEachChild<T>(visitNode: (node: AstNode) => T, visitList?: (nodes: readonly AstNode[]) => T): T | undefined {
    const wire = this.file.wire;
    const tree = wire.preorder();
    if (tree === null) return this.forEachLinkedChild(visitNode, visitList);
    // In the checked preorder tree, the first child follows its parent and each later child starts where the previous child's subtree ends.
    const kinds = tree.kinds;
    const ends = tree.ends;
    const stop = ends[this.index]!;
    for (let index = this.index + 1; index < stop; index = ends[index]!) {
      const kind = kinds[index]!;
      if (kind === PREORDER_LIST) {
        const result = this.visitChildList(index, visitNode, visitList);
        if (result) return result;
      } else if (kind !== AstKind.JSDoc) {
        const result = visitNode(this.file.node(index));
        if (result) return result;
      }
    }
    return undefined;
  }

  /** forEachChild through the sibling and parent links. */
  private forEachLinkedChild<T>(visitNode: (node: AstNode) => T, visitList?: (nodes: readonly AstNode[]) => T): T | undefined {
    const wire = this.file.wire;
    // Walk the immutable sibling links directly. Repeated semantic scans
    // should not allocate and free a temporary child-index array per node.
    for (let index = wire.firstChild(this.index); index !== 0; index = wire.next(index)) {
      if (wire.parent(index) !== this.index) throw new AstDecodeError("sibling belongs to another parent");
      const kind = wire.kind(index);
      if (kind === KIND_NODE_LIST) {
        const result = this.visitChildList(index, visitNode, visitList);
        if (result) return result;
      } else if (kind !== AstKind.JSDoc) {
        const result = visitNode(this.file.node(index));
        if (result) return result;
      }
    }
    return undefined;
  }

  private visitChildList<T>(index: number, visitNode: (node: AstNode) => T, visitList?: (nodes: readonly AstNode[]) => T): T | undefined {
    const list = this.file.list(index);
    if (visitList !== undefined) return visitList(list);
    for (const node of list) {
      const result = visitNode(node);
      if (result) return result;
    }
    return undefined;
  }

  get jsDoc(): AstNode[] | undefined {
    const docs: AstNode[] = [];
    for (const index of this.file.wire.children(this.index)) {
      if (this.file.wire.kind(index) === AstKind.JSDoc) docs.push(this.file.node(index));
    }
    return docs.length === 0 ? undefined : docs;
  }

  getSourceFile(): SourceFile { return this.file.sourceFile; }
  getStart(sourceFile?: AstNode, includeJsDocComment?: boolean): number {
    if (this.pos === this.end && this.pos >= 0 && this.kind !== AstKind.EndOfFile) return this.pos;
    const source = sourceFile ?? this.file.root;
    const text = source.text ?? "";
    if ((this.kind >= AstKind.FirstJSDocNode && this.kind <= AstKind.LastJSDocNode) || this.kind === AstKind.JsxText) {
      return astSkipTrivia(text, this.pos, true, false);
    }
    if (includeJsDocComment) {
      const docs = this.jsDoc;
      if (docs !== undefined && docs.length > 0) return docs[0]!.getStart(source, false);
    }
    return astSkipTrivia(text, this.pos, false, (this.flags & AstNodeFlags.JSDoc) !== 0);
  }
  getFullStart(): number { return this.pos; }
  getEnd(): number { return this.end; }
  getWidth(sourceFile?: AstNode): number { return this.end - this.getStart(sourceFile); }
  getFullWidth(): number { return this.end - this.pos; }
  getLeadingTriviaWidth(sourceFile?: AstNode): number { return this.getStart(sourceFile) - this.pos; }
  getFullText(sourceFile?: AstNode): string { return ((sourceFile ?? this.file.root).text ?? "").substring(this.pos, this.end); }
  getText(sourceFile?: AstNode): string {
    const source = sourceFile ?? this.file.root;
    return (source.text ?? "").substring(this.getStart(source), this.end);
  }

  get containsOnlyTriviaWhiteSpaces(): boolean { return (this.data & (1 << 24)) !== 0; }
  get isArrayType(): boolean { return (this.data & (1 << 24)) !== 0; }
  get isBracketed(): boolean { return (this.data & (1 << 24)) !== 0; }
  get isExportEquals(): boolean { return (this.data & (1 << 24)) !== 0; }
  get isNameFirst(): boolean { return (this.data & (1 << 25)) !== 0; }
  get isTypeOf(): boolean { return (this.data & (1 << 24)) !== 0; }
  get isTypeOnly(): boolean { return (this.data & (1 << 24)) !== 0; }
  get multiLine(): boolean { return (this.data & (1 << 24)) !== 0; }
  get keyword(): number | undefined {
    return this.kind === AstKind.ModuleDeclaration ? ((this.data >>> 24) & 1 ? AstKind.NamespaceKeyword : AstKind.ModuleKeyword) : undefined;
  }
  get keywordToken(): number | undefined {
    return this.kind === AstKind.MetaProperty ? ((this.data >>> 24) & 1 ? AstKind.NewKeyword : AstKind.ImportKeyword) : undefined;
  }
  get operator(): number | undefined {
    const value = (this.data >>> 24) & 7;
    if (this.kind === AstKind.PrefixUnaryExpression) {
      switch (value) {
        case 1: return AstKind.MinusToken;
        case 2: return AstKind.TildeToken;
        case 3: return AstKind.ExclamationToken;
        case 4: return AstKind.PlusPlusToken;
        case 5: return AstKind.MinusMinusToken;
        default: return AstKind.PlusToken;
      }
    }
    if (this.kind === AstKind.PostfixUnaryExpression) return value & 1 ? AstKind.MinusMinusToken : AstKind.PlusPlusToken;
    if (this.kind === AstKind.TypeOperator) return (value & 3) === 1 ? AstKind.ReadonlyKeyword : (value & 3) === 2 ? AstKind.UniqueKeyword : AstKind.KeyOfKeyword;
    return undefined;
  }
  get phaseModifier(): number | undefined {
    if (this.kind !== AstKind.ImportClause) return undefined;
    const value = (this.data >>> 24) & 3;
    return value === 1 ? AstKind.TypeKeyword : value === 2 ? AstKind.DeferKeyword : undefined;
  }
  get token(): number | undefined {
    if (this.kind === AstKind.HeritageClause) return (this.data >>> 24) & 1 ? AstKind.ImplementsKeyword : AstKind.ExtendsKeyword;
    if (this.kind === AstKind.ImportAttributes) return (this.data >>> 25) & 1 ? AstKind.AssertKeyword : AstKind.WithKeyword;
    return undefined;
  }
  get templateFlags(): number | undefined {
    return this.kind === AstKind.TemplateHead || this.kind === AstKind.TemplateMiddle || this.kind === AstKind.TemplateTail
      ? this.file.wire.extendedWord(this.index, 8) : undefined;
  }
  get tokenFlags(): number {
    return this.kind === AstKind.StringLiteral || this.kind === AstKind.NumericLiteral || this.kind === AstKind.BigIntLiteral || this.kind === AstKind.RegularExpressionLiteral
      ? this.file.wire.extendedWord(this.index, 4) : 0;
  }
  get modifierFlags(): number {
    let result = 0;
    for (const modifier of this.childList("modifiers") ?? []) result |= astModifierFlag(modifier.kind);
    return result;
  }

  get body(): AstNode | undefined {
    const body = this.childNodeAt(this.bodySlot());
    // TS7 can serialize a reparsed @type callable before a method's
    // body without setting the type presence bit. The linked Block is
    // still the real body; keep the JSDoc node out of this view.
    if (body !== undefined && (body.flags & AstNodeFlags.JSDoc) !== 0 && (body.flags & AstNodeFlags.Reparsed) !== 0) {
      const next = this.file.wire.next(body.index);
      if (next !== 0 && this.file.wire.parent(next) === this.index && this.file.wire.kind(next) === AstKind.Block) {
        return this.file.node(next);
      }
    }
    return body;
  }

  get questionToken(): AstNode | undefined {
    const direct = this.childNodeAt(this.questionTokenSlot());
    if (direct !== undefined) return direct;
    // TypeScript 7 shares one postfix slot for optional and definite-
    // assignment declarations. The familiar helper surface keeps them apart.
    const token = this.postfixToken;
    return token?.kind === SyntaxKind.QuestionToken ? token : undefined;
  }

  // BEGIN GENERATED CHILD GETTERS
  // Generated from typescript@7.0.2; run scripts/generate-ts7-ast-schema.mjs.
  get argument(): AstNode | undefined {
    switch (this.kind) {
      case 206:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get argumentExpression(): AstNode | undefined {
    switch (this.kind) {
      case 213:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get arguments(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 215:
        return this.childListAt(2);
      case 214:
        return this.childListAt(3);
      default:
        return undefined;
    }
  }
  get assertsModifier(): AstNode | undefined {
    switch (this.kind) {
      case 183:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get asteriskToken(): AstNode | undefined {
    switch (this.kind) {
      case 230:
        return this.childNodeAt(0);
      case 175:
      case 219:
      case 263:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get attributes(): AstNode | readonly AstNode[] | undefined {
    switch (this.kind) {
      case 301:
        return this.childAt(0);
      case 206:
        return this.childAt(1);
      case 286:
      case 287:
        return this.childAt(2);
      case 273:
      case 279:
      case 343:
      case 346:
        return this.childAt(3);
      default:
        return undefined;
    }
  }
  get awaitModifier(): AstNode | undefined {
    switch (this.kind) {
      case 250:
      case 251:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get block(): AstNode | undefined {
    switch (this.kind) {
      case 300:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get caseBlock(): AstNode | undefined {
    switch (this.kind) {
      case 256:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get catchClause(): AstNode | undefined {
    switch (this.kind) {
      case 259:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get checkType(): AstNode | undefined {
    switch (this.kind) {
      case 195:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get children(): AstNode | readonly AstNode[] | undefined {
    switch (this.kind) {
      case 344:
        return this.childAt(0);
      case 285:
      case 289:
        return this.childAt(1);
      default:
        return undefined;
    }
  }
  get className(): AstNode | undefined {
    switch (this.kind) {
      case 323:
      case 324:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get clauses(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 270:
        return this.childListAt(0);
      default:
        return undefined;
    }
  }
  get closingElement(): AstNode | undefined {
    switch (this.kind) {
      case 285:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get closingFragment(): AstNode | undefined {
    switch (this.kind) {
      case 289:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get colonToken(): AstNode | undefined {
    switch (this.kind) {
      case 228:
        return this.childNodeAt(3);
      default:
        return undefined;
    }
  }
  get comment(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 315:
        return this.childListAt(0);
      case 322:
      case 325:
      case 326:
      case 327:
      case 328:
      case 329:
      case 330:
        return this.childListAt(1);
      case 323:
      case 324:
      case 332:
      case 334:
      case 335:
      case 336:
      case 339:
      case 341:
      case 342:
        return this.childListAt(2);
      case 331:
      case 333:
      case 337:
      case 338:
      case 340:
        return this.childListAt(3);
      case 343:
        return this.childListAt(4);
      default:
        return undefined;
    }
  }
  get condition(): AstNode | undefined {
    switch (this.kind) {
      case 228:
        return this.childNodeAt(0);
      case 249:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get constraint(): AstNode | undefined {
    switch (this.kind) {
      case 337:
        return this.childNodeAt(1);
      case 169:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get declarationList(): AstNode | undefined {
    switch (this.kind) {
      case 244:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get declarations(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 262:
        return this.childListAt(0);
      default:
        return undefined;
    }
  }
  get defaultType(): AstNode | undefined {
    switch (this.kind) {
      case 169:
        return this.childNodeAt(4);
      default:
        return undefined;
    }
  }
  get dotDotDotToken(): AstNode | undefined {
    switch (this.kind) {
      case 203:
      case 209:
      case 295:
        return this.childNodeAt(0);
      case 170:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get elementType(): AstNode | undefined {
    switch (this.kind) {
      case 189:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get elements(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 190:
      case 207:
      case 208:
      case 210:
      case 276:
      case 280:
        return this.childListAt(0);
      default:
        return undefined;
    }
  }
  get elseStatement(): AstNode | undefined {
    switch (this.kind) {
      case 246:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get endOfFileToken(): AstNode | undefined {
    switch (this.kind) {
      case 307:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get equalsGreaterThanToken(): AstNode | undefined {
    switch (this.kind) {
      case 220:
        return this.childNodeAt(4);
      default:
        return undefined;
    }
  }
  get equalsToken(): AstNode | undefined {
    switch (this.kind) {
      case 304:
        return this.childNodeAt(4);
      default:
        return undefined;
    }
  }
  get exclamationToken(): AstNode | undefined {
    switch (this.kind) {
      case 261:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get exportClause(): AstNode | undefined {
    switch (this.kind) {
      case 279:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get exprName(): AstNode | undefined {
    switch (this.kind) {
      case 187:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get expression(): AstNode | undefined {
    switch (this.kind) {
      case 168:
      case 171:
      case 212:
      case 213:
      case 214:
      case 215:
      case 218:
      case 221:
      case 222:
      case 223:
      case 224:
      case 231:
      case 234:
      case 235:
      case 236:
      case 239:
      case 240:
      case 245:
      case 246:
      case 248:
      case 254:
      case 255:
      case 256:
      case 258:
      case 284:
      case 294:
      case 297:
      case 298:
      case 305:
      case 348:
      case 349:
        return this.childNodeAt(0);
      case 217:
      case 230:
      case 247:
      case 295:
        return this.childNodeAt(1);
      case 250:
      case 251:
      case 278:
        return this.childNodeAt(2);
      case 169:
        return this.childNodeAt(3);
      default:
        return undefined;
    }
  }
  get extendsType(): AstNode | undefined {
    switch (this.kind) {
      case 195:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get falseType(): AstNode | undefined {
    switch (this.kind) {
      case 195:
        return this.childNodeAt(3);
      default:
        return undefined;
    }
  }
  get finallyBlock(): AstNode | undefined {
    switch (this.kind) {
      case 259:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get head(): AstNode | undefined {
    switch (this.kind) {
      case 204:
      case 229:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get heritageClauses(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 232:
      case 264:
      case 265:
        return this.childListAt(3);
      default:
        return undefined;
    }
  }
  get importClause(): AstNode | undefined {
    switch (this.kind) {
      case 273:
      case 343:
      case 346:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get incrementor(): AstNode | undefined {
    switch (this.kind) {
      case 249:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get indexType(): AstNode | undefined {
    switch (this.kind) {
      case 200:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get initializer(): AstNode | undefined {
    switch (this.kind) {
      case 249:
        return this.childNodeAt(0);
      case 250:
      case 251:
      case 292:
      case 306:
        return this.childNodeAt(1);
      case 209:
      case 261:
        return this.childNodeAt(3);
      case 172:
      case 173:
      case 303:
        return this.childNodeAt(4);
      case 170:
        return this.childNodeAt(5);
      default:
        return undefined;
    }
  }
  get jsdocPropertyTags(): AstNode | undefined {
    switch (this.kind) {
      case 317:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get label(): AstNode | undefined {
    switch (this.kind) {
      case 252:
      case 253:
      case 257:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get left(): AstNode | undefined {
    switch (this.kind) {
      case 167:
        return this.childNodeAt(0);
      case 227:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get literal(): AstNode | undefined {
    switch (this.kind) {
      case 202:
        return this.childNodeAt(0);
      case 205:
      case 240:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get members(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 188:
        return this.childListAt(0);
      case 267:
        return this.childListAt(2);
      case 232:
      case 264:
      case 265:
        return this.childListAt(4);
      case 201:
        return this.childListAt(5);
      default:
        return undefined;
    }
  }
  get modifiers(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 169:
      case 170:
      case 172:
      case 173:
      case 174:
      case 175:
      case 176:
      case 177:
      case 178:
      case 179:
      case 182:
      case 186:
      case 219:
      case 220:
      case 227:
      case 232:
      case 244:
      case 263:
      case 264:
      case 265:
      case 266:
      case 267:
      case 268:
      case 271:
      case 272:
      case 273:
      case 278:
      case 279:
      case 283:
      case 303:
      case 304:
      case 345:
      case 346:
        return this.childListAt(0);
      default:
        return undefined;
    }
  }
  get moduleReference(): AstNode | undefined {
    switch (this.kind) {
      case 272:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get moduleSpecifier(): AstNode | undefined {
    switch (this.kind) {
      case 273:
      case 279:
      case 343:
      case 346:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get name(): AstNode | undefined {
    switch (this.kind) {
      case 237:
      case 261:
      case 274:
      case 275:
      case 281:
      case 292:
      case 302:
      case 306:
      case 309:
      case 319:
      case 320:
      case 321:
        return this.childNodeAt(0);
      case 169:
      case 172:
      case 173:
      case 174:
      case 178:
      case 179:
      case 203:
      case 232:
      case 264:
      case 265:
      case 266:
      case 267:
      case 268:
      case 271:
      case 272:
      case 277:
      case 282:
      case 296:
      case 303:
      case 304:
      case 333:
      case 340:
      case 345:
        return this.childNodeAt(1);
      case 170:
      case 175:
      case 209:
      case 212:
      case 219:
      case 263:
      case 331:
      case 338:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get nameExpression(): AstNode | undefined {
    switch (this.kind) {
      case 339:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get nameType(): AstNode | undefined {
    switch (this.kind) {
      case 201:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get namedBindings(): AstNode | undefined {
    switch (this.kind) {
      case 274:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get namespace(): AstNode | undefined {
    switch (this.kind) {
      case 296:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get objectAssignmentInitializer(): AstNode | undefined {
    switch (this.kind) {
      case 304:
        return this.childNodeAt(5);
      default:
        return undefined;
    }
  }
  get objectType(): AstNode | undefined {
    switch (this.kind) {
      case 200:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get openingElement(): AstNode | undefined {
    switch (this.kind) {
      case 285:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get openingFragment(): AstNode | undefined {
    switch (this.kind) {
      case 289:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get operand(): AstNode | undefined {
    switch (this.kind) {
      case 225:
      case 226:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get operatorToken(): AstNode | undefined {
    switch (this.kind) {
      case 227:
        return this.childNodeAt(3);
      default:
        return undefined;
    }
  }
  get parameterName(): AstNode | undefined {
    switch (this.kind) {
      case 183:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get parameters(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 180:
      case 181:
      case 182:
      case 185:
      case 318:
        return this.childListAt(1);
      case 177:
      case 186:
      case 220:
        return this.childListAt(2);
      case 178:
      case 179:
        return this.childListAt(3);
      case 174:
      case 219:
      case 263:
        return this.childListAt(4);
      case 175:
        return this.childListAt(5);
      default:
        return undefined;
    }
  }
  get postfixToken(): AstNode | undefined {
    switch (this.kind) {
      case 172:
      case 173:
      case 174:
      case 303:
      case 304:
        return this.childNodeAt(2);
      case 175:
        return this.childNodeAt(3);
      default:
        return undefined;
    }
  }
  get properties(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 211:
      case 293:
        return this.childListAt(0);
      default:
        return undefined;
    }
  }
  get propertyName(): AstNode | undefined {
    switch (this.kind) {
      case 277:
      case 282:
        return this.childNodeAt(0);
      case 209:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get qualifier(): AstNode | undefined {
    switch (this.kind) {
      case 206:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get questionDotToken(): AstNode | undefined {
    switch (this.kind) {
      case 212:
      case 213:
      case 214:
      case 216:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get readonlyToken(): AstNode | undefined {
    switch (this.kind) {
      case 201:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get right(): AstNode | undefined {
    switch (this.kind) {
      case 167:
        return this.childNodeAt(1);
      case 227:
        return this.childNodeAt(4);
      default:
        return undefined;
    }
  }
  get statement(): AstNode | undefined {
    switch (this.kind) {
      case 247:
        return this.childNodeAt(0);
      case 248:
      case 255:
      case 257:
        return this.childNodeAt(1);
      case 249:
      case 250:
      case 251:
        return this.childNodeAt(3);
      default:
        return undefined;
    }
  }
  get statements(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 242:
      case 269:
      case 307:
        return this.childListAt(0);
      case 297:
      case 298:
        return this.childListAt(1);
      default:
        return undefined;
    }
  }
  get tag(): AstNode | undefined {
    switch (this.kind) {
      case 216:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get tagName(): AstNode | undefined {
    switch (this.kind) {
      case 286:
      case 287:
      case 288:
      case 322:
      case 323:
      case 324:
      case 325:
      case 326:
      case 327:
      case 328:
      case 329:
      case 330:
      case 331:
      case 332:
      case 333:
      case 334:
      case 335:
      case 336:
      case 337:
      case 338:
      case 339:
      case 340:
      case 341:
      case 342:
      case 343:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get tags(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 315:
        return this.childListAt(1);
      default:
        return undefined;
    }
  }
  get template(): AstNode | undefined {
    switch (this.kind) {
      case 216:
        return this.childNodeAt(3);
      default:
        return undefined;
    }
  }
  get templateSpans(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 204:
      case 229:
        return this.childListAt(1);
      default:
        return undefined;
    }
  }
  get thenStatement(): AstNode | undefined {
    switch (this.kind) {
      case 246:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get thisArg(): AstNode | undefined {
    switch (this.kind) {
      case 349:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get trueType(): AstNode | undefined {
    switch (this.kind) {
      case 195:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get tryBlock(): AstNode | undefined {
    switch (this.kind) {
      case 259:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get tupleNameSource(): AstNode | undefined {
    switch (this.kind) {
      case 238:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get type(): AstNode | undefined {
    switch (this.kind) {
      case 191:
      case 192:
      case 197:
      case 199:
      case 205:
      case 217:
      case 308:
      case 311:
      case 312:
      case 313:
      case 314:
        return this.childNodeAt(0);
      case 235:
      case 239:
      case 278:
        return this.childNodeAt(1);
      case 180:
      case 181:
      case 182:
      case 183:
      case 185:
      case 227:
      case 261:
      case 318:
        return this.childNodeAt(2);
      case 172:
      case 173:
      case 177:
      case 186:
      case 203:
      case 220:
      case 266:
      case 303:
      case 304:
      case 345:
        return this.childNodeAt(3);
      case 170:
      case 178:
      case 179:
      case 201:
        return this.childNodeAt(4);
      case 174:
      case 219:
      case 263:
        return this.childNodeAt(5);
      case 175:
        return this.childNodeAt(6);
      default:
        return undefined;
    }
  }
  get typeArguments(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 184:
      case 187:
      case 215:
      case 234:
      case 286:
      case 287:
        return this.childListAt(1);
      case 214:
      case 216:
        return this.childListAt(2);
      case 206:
        return this.childListAt(3);
      default:
        return undefined;
    }
  }
  get typeExpression(): AstNode | undefined {
    switch (this.kind) {
      case 331:
      case 332:
      case 334:
      case 335:
      case 336:
      case 338:
      case 341:
      case 342:
        return this.childNodeAt(1);
      case 333:
      case 340:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  get typeName(): AstNode | undefined {
    switch (this.kind) {
      case 184:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get typeParameter(): AstNode | undefined {
    switch (this.kind) {
      case 196:
        return this.childNodeAt(0);
      case 201:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get typeParameters(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 180:
      case 181:
      case 185:
      case 318:
        return this.childListAt(0);
      case 177:
      case 186:
      case 220:
        return this.childListAt(1);
      case 178:
      case 179:
      case 232:
      case 264:
      case 265:
      case 266:
      case 337:
      case 345:
        return this.childListAt(2);
      case 174:
      case 219:
      case 263:
        return this.childListAt(3);
      case 175:
        return this.childListAt(4);
      default:
        return undefined;
    }
  }
  get types(): readonly AstNode[] | undefined {
    switch (this.kind) {
      case 193:
      case 194:
      case 299:
        return this.childListAt(0);
      default:
        return undefined;
    }
  }
  get value(): AstNode | undefined {
    switch (this.kind) {
      case 302:
        return this.childNodeAt(1);
      default:
        return undefined;
    }
  }
  get variableDeclaration(): AstNode | undefined {
    switch (this.kind) {
      case 300:
        return this.childNodeAt(0);
      default:
        return undefined;
    }
  }
  get whenFalse(): AstNode | undefined {
    switch (this.kind) {
      case 228:
        return this.childNodeAt(4);
      default:
        return undefined;
    }
  }
  get whenTrue(): AstNode | undefined {
    switch (this.kind) {
      case 228:
        return this.childNodeAt(2);
      default:
        return undefined;
    }
  }
  private bodySlot(): number {
    switch (this.kind) {
      case 176:
        return 1;
      case 268:
        return 2;
      case 177:
        return 4;
      case 178:
      case 179:
      case 220:
        return 5;
      case 219:
      case 263:
        return 6;
      case 175:
        return 7;
      default:
        return -1;
    }
  }
  private questionTokenSlot(): number {
    switch (this.kind) {
      case 228:
        return 1;
      case 203:
        return 2;
      case 170:
      case 201:
        return 3;
      default:
        return -1;
    }
  }
  // END GENERATED CHILD GETTERS

  // Source-file fields stay on the same nominal class, matching the wire's
  // single node representation. Their extended-data accesses are checked.
  get fileName(): string { return this.file.wire.string(this.file.wire.extendedWord(this.index, 4)); }
  get path(): string { return this.file.wire.string(this.file.wire.extendedWord(this.index, 8)); }
  get languageVariant(): number { return this.file.wire.extendedWord(this.index, 12); }
  get scriptKind(): number { return this.file.wire.extendedWord(this.index, 16); }
  get isDeclarationFile(): boolean { return (this.flags & AstNodeFlags.Ambient) !== 0; }
  get referencedFiles(): AstFileReference[] { return this.file.fileReferences(this.file.wire.extendedWord(this.index, 20)); }
  get typeReferenceDirectives(): AstFileReference[] { return this.file.fileReferences(this.file.wire.extendedWord(this.index, 24)); }
  get libReferenceDirectives(): AstFileReference[] { return this.file.fileReferences(this.file.wire.extendedWord(this.index, 28)); }
  get imports(): AstNode[] { return this.file.nodeReferences(this.file.wire.extendedWord(this.index, 32)); }
  get moduleAugmentations(): AstNode[] { return this.file.nodeReferences(this.file.wire.extendedWord(this.index, 36)); }
  get ambientModuleNames(): string[] { return this.file.stringReferences(this.file.wire.extendedWord(this.index, 40)); }
  get externalModuleIndicator(): AstNode | true | undefined {
    const index = this.file.wire.extendedWord(this.index, 44);
    return index === 0 ? undefined : index === this.index ? true : this.file.node(index);
  }
  getLineStarts(): number[] { return this.file.lineStarts(); }
  getLineAndCharacterOfPosition(position: number): { line: number; character: number } {
    const starts = this.getLineStarts();
    const line = astLineOfPosition(starts, position);
    return { line, character: position - starts[line]! };
  }
  getPositionOfLineAndCharacter(line: number, character: number): number {
    const starts = this.getLineStarts();
    if (line < 0 || line >= starts.length) throw new Error(`Bad line number. Line: ${line}, lineStarts.length: ${starts.length}`);
    return starts[line]! + character;
  }
  getOrCreateNodeAtIndex(index: number): AstNode { return this.file.node(index); }
}

function astModifierFlag(kind: number): number {
  switch (kind) {
    case AstKind.StaticKeyword: return AstModifierFlags.Static;
    case AstKind.PublicKeyword: return AstModifierFlags.Public;
    case AstKind.ProtectedKeyword: return AstModifierFlags.Protected;
    case AstKind.PrivateKeyword: return AstModifierFlags.Private;
    case AstKind.AbstractKeyword: return AstModifierFlags.Abstract;
    case AstKind.AccessorKeyword: return AstModifierFlags.Accessor;
    case AstKind.ExportKeyword: return AstModifierFlags.Export;
    case AstKind.DeclareKeyword: return AstModifierFlags.Ambient;
    case AstKind.ConstKeyword: return AstModifierFlags.Const;
    case AstKind.DefaultKeyword: return AstModifierFlags.Default;
    case AstKind.AsyncKeyword: return AstModifierFlags.Async;
    case AstKind.ReadonlyKeyword: return AstModifierFlags.Readonly;
    case AstKind.OverrideKeyword: return AstModifierFlags.Override;
    case AstKind.InKeyword: return AstModifierFlags.In;
    case AstKind.OutKeyword: return AstModifierFlags.Out;
    case AstKind.Decorator: return AstModifierFlags.Decorator;
    default: return AstModifierFlags.None;
  }
}
