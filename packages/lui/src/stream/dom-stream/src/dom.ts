// Copied from packages/dom-stream/src/dom.ts by packages/lui/scripts/sync-stream.mjs. Do not edit; edit the original and run the script.
/// <reference path="./dom-imports.d.ts" />
// The compiled side of the DOM bridge: nodes a renderer creates and changes in compiled code, with every change written to the DOM
// stream (dom.schema.json) and replayed by the page once per flush (src/dom-host.js).
//
// A node here is a compiled object with a handle into the page's node table. It also keeps its place in the tree (parent, first and
// last child, siblings), so reads of structure are answered here, with no call. That holds while the page leaves the renderer's nodes
// to the renderer, as React DOM requires. A node the page made and handed over (a root container, adopted) has children this side has
// not seen: its child reads ask the page.
//
// `page(node)` is the way back to the page node itself (a ref, an API this bridge does not cover): it flushes the stream first, so the
// page node is up to date, and costs one call the first time.
import { adopt, delegated, describe, events, handleAbove, node as pageNodeOf, template as pageTemplate } from "host:dom";
import { DomStream } from "./dom-stream.generated";

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;
export const DOCUMENT_FRAGMENT_NODE = 11;

export class DomNode {
  readonly handle: number;
  readonly nodeType: number;
  /** nodeName as the DOM spells it ("DIV", "#text"). */
  readonly nodeName: string;
  readonly ownerDocument: DomDocument | null;
  parentNode: DomNode | null = null;
  firstChild: DomNode | null = null;
  lastChild: DomNode | null = null;
  nextSibling: DomNode | null = null;
  previousSibling: DomNode | null = null;
  /** Whether this side has seen every child (false for an adopted node). */
  childrenKnown: boolean = true;
  /** The page node, once asked for. */
  pageNode: Node | null = null;
  /** The renderer's own state for this node (React DOM keeps its fiber and props here). */
  internals: object | null = null;
  /** Its listeners (listen), by index; a removed one is null. They live as long as the node does. */
  listeners: (((event: Event) => void) | null)[] | null = null;
  /** Its handlers for delegated events (setHandler), by delegated type (delegatedType); none is null. */
  handlers: (((event: Event) => void) | null)[] | null = null;

  constructor(handle: number, nodeType: number, nodeName: string, ownerDocument: DomDocument | null) {
    this.handle = handle;
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  appendChild(child: DomNode): DomNode {
    dom.appendChild(this.handle, child.handle);
    if (child.nodeType === DOCUMENT_FRAGMENT_NODE) {
      adoptChildren(this, child, null);
      return child;
    }
    unlink(child);
    child.parentNode = this;
    const last = this.lastChild;
    child.previousSibling = last;
    child.nextSibling = null;
    if (last === null) this.firstChild = child;
    else last.nextSibling = child;
    this.lastChild = child;
    return child;
  }

  insertBefore(child: DomNode, before: DomNode | null): DomNode {
    if (before === null) return this.appendChild(child);
    dom.insertBefore(this.handle, child.handle, before.handle);
    if (child.nodeType === DOCUMENT_FRAGMENT_NODE) {
      adoptChildren(this, child, before);
      return child;
    }
    unlink(child);
    child.parentNode = this;
    const prev = before.previousSibling;
    child.previousSibling = prev;
    child.nextSibling = before;
    before.previousSibling = child;
    if (prev === null) this.firstChild = child;
    else prev.nextSibling = child;
    return child;
  }

  removeChild(child: DomNode): DomNode {
    dom.removeChild(this.handle, child.handle);
    unlink(child);
    return child;
  }

  /** remove(): out of its parent, when it has one. */
  remove(): void {
    const parent = this.parentNode;
    if (parent !== null) parent.removeChild(this);
  }

  /** textContent = text: every child goes, and a text node holds `text` (none for ""). */
  setTextContent(text: string): void {
    dom.setTextContent(this.handle, text);
    let c = this.firstChild;
    while (c !== null) {
      const next = c.nextSibling;
      c.parentNode = null;
      c.nextSibling = null;
      c.previousSibling = null;
      c = next;
    }
    this.firstChild = null;
    this.lastChild = null;
    // The page made the text node, so this side has not seen it.
    this.childrenKnown = text === "";
  }

  /** Whether `other` is this node or inside it, as far as this side knows the tree. */
  contains(other: DomNode | null): boolean {
    let n = other;
    while (n !== null) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
}

/** A fragment's children move into `parent` before `before` (null: at the end), as the page's insertion of the fragment
 * moved them (this side only). */
function adoptChildren(parent: DomNode, fragment: DomNode, before: DomNode | null): void {
  let c = fragment.firstChild;
  while (c !== null) {
    const next = c.nextSibling;
    unlink(c);
    c.parentNode = parent;
    const prev = before === null ? parent.lastChild : before.previousSibling;
    c.previousSibling = prev;
    c.nextSibling = before;
    if (prev === null) parent.firstChild = c;
    else prev.nextSibling = c;
    if (before === null) parent.lastChild = c;
    else before.previousSibling = c;
    c = next;
  }
}

/** Links `child` as the last child of `parent` (this side only; the page made the structure itself). */
function linkLast(parent: DomNode, child: DomNode): void {
  child.parentNode = parent;
  const last = parent.lastChild;
  child.previousSibling = last;
  if (last === null) parent.firstChild = child;
  else last.nextSibling = child;
  parent.lastChild = child;
}

/** Takes `child` out of its parent's child list (this side only). */
function unlink(child: DomNode): void {
  const parent = child.parentNode;
  if (parent === null) return;
  const prev = child.previousSibling, next = child.nextSibling;
  if (prev === null) parent.firstChild = next;
  else prev.nextSibling = next;
  if (next === null) parent.lastChild = prev;
  else next.previousSibling = prev;
  child.parentNode = null;
  child.previousSibling = null;
  child.nextSibling = null;
}

export class DomStyle {
  readonly owner: DomElement;
  constructor(owner: DomElement) {
    this.owner = owner;
  }
  /** style[name] = value (a custom property, `--name`, through setProperty). */
  set(name: string, value: string): void {
    dom.setStyle(this.owner.handle, dom.atom(name), value);
  }
  /** style[name] = "" (a custom property through removeProperty). */
  remove(name: string): void {
    dom.removeStyle(this.owner.handle, dom.atom(name));
  }
  setProperty(name: string, value: string, priority: string): void {
    dom.setStyleProperty(this.owner.handle, dom.atom(name), value, dom.atom(priority));
  }
}

export class DomElement extends DomNode {
  /** The tag as written (lower case for HTML), and the element's namespace ("" for none). */
  readonly localName: string;
  readonly namespaceURI: string;
  private styleView: DomStyle | null = null;

  constructor(handle: number, localName: string, namespaceURI: string, nodeName: string, ownerDocument: DomDocument | null) {
    super(handle, ELEMENT_NODE, nodeName, ownerDocument);
    this.localName = localName;
    this.namespaceURI = namespaceURI;
  }

  get tagName(): string {
    return this.nodeName;
  }

  get style(): DomStyle {
    let s = this.styleView;
    if (s === null) {
      s = new DomStyle(this);
      this.styleView = s;
    }
    return s;
  }

  setAttribute(name: string, value: string): void {
    dom.setAttribute(this.handle, dom.atom(name), value);
  }
  setAttributeNS(ns: string, name: string, value: string): void {
    dom.setAttributeNS(this.handle, dom.atom(ns), dom.atom(name), value);
  }
  removeAttribute(name: string): void {
    dom.removeAttribute(this.handle, dom.atom(name));
  }
  /** node[name] = value, for the IDL attributes a renderer sets as properties (value, checked, muted, ...). */
  setPropString(name: string, value: string): void {
    dom.setPropString(this.handle, dom.atom(name), value);
  }
  setPropNumber(name: string, value: number): void {
    dom.setPropNumber(this.handle, dom.atom(name), value);
  }
  setPropBool(name: string, value: boolean): void {
    dom.setPropBool(this.handle, dom.atom(name), value);
  }
  setPropNull(name: string): void {
    dom.setPropNull(this.handle, dom.atom(name));
  }
  setInnerHTML(html: string): void {
    dom.setInnerHTML(this.handle, html);
    this.childrenKnown = false;
    this.firstChild = null;
    this.lastChild = null;
  }
  /** Whether trapClick set onclick (it stays set). */
  clickTrapped: boolean = false;
  /** onclick = a no-op function. */
  trapClick(): void {
    this.clickTrapped = true;
    dom.trapClick(this.handle);
  }
}

export class DomText extends DomNode {
  /** The text as this side last set it. */
  data: string;
  constructor(handle: number, nodeType: number, nodeName: string, data: string, ownerDocument: DomDocument | null) {
    super(handle, nodeType, nodeName, ownerDocument);
    this.data = data;
  }
  get nodeValue(): string {
    return this.data;
  }
  setNodeValue(text: string): void {
    this.data = text;
    dom.setNodeValue(this.handle, text);
  }
}

/** A document fragment: inserting it moves its children (a template clone with several top-level nodes). */
export class DomFragment extends DomNode {
  constructor(handle: number, ownerDocument: DomDocument | null) {
    super(handle, DOCUMENT_FRAGMENT_NODE, "#document-fragment", ownerDocument);
  }
}

export class DomDocument extends DomNode {
  constructor(handle: number) {
    super(handle, DOCUMENT_NODE, "#document", null);
  }
  createElement(tag: string): DomElement {
    const h = allocate();
    dom.createElement(h, this.handle, dom.atom(tag));
    return register(new DomElement(h, tag, HTML_NAMESPACE, htmlNodeName(tag), this));
  }
  createElementIs(tag: string, is: string): DomElement {
    const h = allocate();
    dom.createElementIs(h, this.handle, dom.atom(tag), is);
    return register(new DomElement(h, tag, HTML_NAMESPACE, htmlNodeName(tag), this));
  }
  createElementNS(ns: string, tag: string): DomElement {
    const h = allocate();
    dom.createElementNS(h, this.handle, dom.atom(ns), dom.atom(tag));
    return register(new DomElement(h, tag, ns, ns === HTML_NAMESPACE ? htmlNodeName(tag) : tag, this));
  }
  createTextNode(text: string): DomText {
    const h = allocate();
    dom.createText(h, this.handle, text);
    return register(new DomText(h, TEXT_NODE, "#text", text, this));
  }
  createDocumentFragment(): DomFragment {
    const h = allocate();
    dom.createFragment(h, this.handle);
    return register(new DomFragment(h, this));
  }
  createComment(text: string): DomText {
    const h = allocate();
    dom.createComment(h, this.handle, text);
    return register(new DomText(h, COMMENT_NODE, "#comment", text, this));
  }
}

export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** An HTML element's nodeName: its tag in upper case (cached per tag). */
const upperNames: Map<string, string> = new Map();
function htmlNodeName(tag: string): string {
  let n = upperNames.get(tag);
  if (n === undefined) {
    n = tag.toUpperCase();
    upperNames.set(tag, n);
  }
  return n;
}

/**
 * A template: HTML the page parses once (host:dom template), cloned with one command per clone (cloneTemplate). The page answers
 * the template's shape when it parses it, so a clone's nodes are made here, already linked, with no further question: its
 * structure, names and text are known on this side, and its children are walked here (firstChild, nextSibling) with no call.
 */
export class DomTemplate {
  readonly id: number;
  /** Nodes in a clone: the root, then every node below it in document order. */
  readonly count: number;
  readonly types: number[] = [];
  readonly childCounts: number[] = [];
  readonly nodeNames: string[] = [];
  readonly localNames: string[] = [];
  readonly namespaces: string[] = [];
  readonly texts: string[] = [];
  constructor(id: number, shape: string) {
    this.id = id;
    const f = shape.split("\u0001");
    let n = 0;
    for (let i = 0; i + 6 <= f.length; i += 6) {
      this.types.push(Number(f[i]!));
      this.childCounts.push(Number(f[i + 1]!));
      this.nodeNames.push(f[i + 2]!);
      this.localNames.push(f[i + 3]!);
      this.namespaces.push(f[i + 4]!);
      this.texts.push(f[i + 5]!);
      n++;
    }
    this.count = n;
  }
}

let nextTemplate = 1;

/** `html` as a template (parsed once, by the page). */
export function domTemplate(html: string): DomTemplate {
  const id = nextTemplate++;
  return new DomTemplate(id, pageTemplate(id, html));
}

const cloneHandles: number[] = [];
const cloneParents: DomNode[] = [];
const cloneLeft: number[] = [];

/** A clone of `t`: its root (an element, or a fragment for several top-level nodes), every node below it known here. */
export function cloneTemplate(t: DomTemplate, ownerDocument: DomDocument | null): DomNode {
  const n = t.count;
  let root: DomNode | null = null;
  let depth = 0;
  for (let i = 0; i < n; i++) {
    const h = allocate();
    cloneHandles[i] = h;
    const type = t.types[i]!;
    let node: DomNode;
    if (type === ELEMENT_NODE) node = new DomElement(h, t.localNames[i]!, t.namespaces[i]!, t.nodeNames[i]!, ownerDocument);
    else if (type === DOCUMENT_FRAGMENT_NODE) node = new DomFragment(h, ownerDocument);
    else node = new DomText(h, type, t.nodeNames[i]!, t.texts[i]!, ownerDocument);
    register(node);
    if (root === null) root = node;
    else {
      linkLast(cloneParents[depth - 1]!, node);
      cloneLeft[depth - 1] = cloneLeft[depth - 1]! - 1;
    }
    const children = t.childCounts[i]!;
    if (children > 0) {
      cloneParents[depth] = node;
      cloneLeft[depth] = children;
      depth++;
    } else {
      while (depth > 0 && cloneLeft[depth - 1] === 0) depth--;
    }
  }
  dom.cloneTemplate(t.id, cloneHandles, n);
  return root!;
}

/** The stream every node writes to. */
export const dom: DomStream = new DomStream(1 << 16);

/** Nodes by handle (null for a free handle); handle 0 is no node. */
const nodes: (DomNode | null)[] = [null];
const freeHandles: number[] = [];

function allocate(): number {
  const h = freeHandles.pop();
  if (h !== undefined) return h;
  nodes.push(null);
  return nodes.length - 1;
}

function register<T extends DomNode>(n: T): T {
  nodes[n.handle] = n;
  return n;
}

/** The node a handle names, or null. */
export function nodeOf(handle: number): DomNode | null {
  return handle > 0 && handle < nodes.length ? nodes[handle]! : null;
}

/** The page forgets `n` (the renderer is done with it): its handle is free again after the next flush is written. */
export function release(n: DomNode): void {
  if (nodes[n.handle] !== n) return;
  dom.free(n.handle);
  nodes[n.handle] = null;
  freeHandles.push(n.handle);
  n.pageNode = null;
  n.listeners = null;
  n.handlers = null;
  n.internals = null;
}

/** `n` and every node below it on this side are released (a renderer's deleted subtree): each one's handle is free again and the
 * page forgets its node, so neither table keeps the subtree alive. */
export function releaseTree(n: DomNode): void {
  let node: DomNode | null = n;
  while (node !== null) {
    const child: DomNode | null = node.firstChild;
    if (child !== null) { node = child; continue; }
    // A leaf: release it, then its finished ancestors, up to the next sibling still to visit.
    let done: DomNode = node;
    for (;;) {
      const next: DomNode | null = done === n ? null : done.nextSibling;
      const parent: DomNode | null = done === n ? null : done.parentNode;
      release(done);
      if (parent !== null) parent.firstChild = next;
      if (next !== null) { node = next; break; }
      if (parent === null) { node = null; break; }
      done = parent;
    }
  }
}

/** Runs the stream now: the page is up to date when this returns. */
export function flushDom(): void {
  if (dom.pending()) dom.flush();
}

/** The page node behind `n`, up to date (the stream is flushed first). */
export function page(n: DomNode): Node {
  flushDom();
  let p = n.pageNode;
  if (p === null) {
    p = pageNodeOf(n.handle);
    n.pageNode = p;
  }
  return p;
}

/** The nearest bridge node at or above a page node (an event's target), or null when none of its ancestors is one. */
export function nodeAbove(p: Node): DomNode | null {
  flushDom();
  const h = handleAbove(p);
  return nodeOf(h < 0 ? -h : h);
}

/** Like nodeAbove, as a handle: positive when the page node is that bridge node itself, negative for an ancestor, 0 for none. */
export function pageHandleAbove(p: Node): number {
  flushDom();
  return handleAbove(p);
}

/** listen's flags: a capture-phase listener; passive; explicitly not passive (absent both, the browser's default). */
export const LISTEN_CAPTURE = 1, LISTEN_PASSIVE = 2, LISTEN_ACTIVE = 4;

let forwarding = false;

/**
 * `node.addEventListener(type, fn, flags)` through the stream: the page registers a forwarder that calls `fn` with the page's event,
 * one call per event. The answer is the listener's index on its node, its handle for unlisten. A listener lives as long as its node:
 * a released node's forwarders send nothing.
 */
export function listen(node: DomNode, type: string, fn: (event: Event) => void, flags: number): number {
  if (!forwarding) {
    forwarding = true;
    events((handle: number, index: number, event: Event): void => {
      const n = nodeOf(handle);
      const own = n === null ? null : n.listeners;
      const f = own !== null && index >= 0 && index < own.length ? own[index]! : null;
      if (f !== null) f(event);
    });
  }
  let own = node.listeners;
  if (own === null) {
    own = [];
    node.listeners = own;
  }
  own.push(fn);
  const index = own.length - 1;
  dom.listen(node.handle, index, dom.atom(type), flags);
  return index;
}

/** The listener `listen` answered `index` for on `node` is removed. */
export function unlisten(node: DomNode, index: number): void {
  const own = node.listeners;
  if (own === null || index < 0 || index >= own.length || own[index] === null) return;
  own[index] = null;
  dom.unlisten(node.handle, index);
}

const DESCRIBE_TYPE = 0, DESCRIBE_NAME = 1, DESCRIBE_NS = 2, DESCRIBE_LOCAL = 3;

/** The node for a page node made outside the bridge (a renderer's container): entered in the node table once. */
export function adoptNode(p: Node): DomNode {
  // adopt answers at once: the page's table must have seen every queued command first (a queued free may name the handle
  // allocate hands out next).
  flushDom();
  const proposed = allocate();
  const h = adopt(p, proposed);
  if (h !== proposed) {
    freeHandles.push(proposed);
    return nodes[h]!;
  }
  const type = Number(describe(p, DESCRIBE_TYPE));
  const name = describe(p, DESCRIBE_NAME);
  let n: DomNode;
  if (type === DOCUMENT_NODE) n = new DomDocument(h);
  else {
    const owner = p.ownerDocument;
    const doc = owner === null ? null : (adoptNode(owner) as DomDocument);
    if (type === ELEMENT_NODE) n = new DomElement(h, describe(p, DESCRIBE_LOCAL), describe(p, DESCRIBE_NS), name, doc);
    else n = new DomText(h, type, name, "", doc);
  }
  n.childrenKnown = false;
  n.pageNode = p;
  return register(n);
}

/** Delegated event types, each a small index into a node's handlers. */
const delegatedTypes: Map<string, number> = new Map();

/** The index of a delegated event type (assigned the first time). */
export function delegatedType(type: string): number {
  let i = delegatedTypes.get(type);
  if (i === undefined) {
    i = delegatedTypes.size;
    delegatedTypes.set(type, i);
  }
  return i;
}

/** `node`'s handler for the delegated type `type` (delegatedType), or none (null). */
export function setHandler(node: DomNode, type: number, fn: ((event: Event) => void) | null): void {
  let own = node.handlers;
  if (own === null) {
    if (fn === null) return;
    own = [];
    node.handlers = own;
  }
  while (own.length <= type) own.push(null);
  own[type] = fn;
}

/** The handler `node` has for the delegated type `type`, or null. */
export function handlerOf(node: DomNode, type: number): ((event: Event) => void) | null {
  const own = node.handlers;
  return own !== null && type < own.length ? own[type]! : null;
}

/** What a delegated listener does with an event: the target is the nearest node of the table at or above the event's
 * target (null when none is). */
export type Delegation = (target: DomNode | null, event: Event) => void;

const delegations: Delegation[] = [];
let delegating = false;

/**
 * One page listener for `type` on `root`: each event that reaches it comes to `onEvent` once, with its target on this side. A
 * renderer that delegates (Solid, Svelte) walks up from the target with `bubble`, or in its own way.
 */
export function delegate(root: DomNode, type: string, onEvent: Delegation): void {
  if (!delegating) {
    delegating = true;
    delegated((delegation: number, target: number, event: Event): void => {
      const f = delegation >= 0 && delegation < delegations.length ? delegations[delegation]! : null;
      if (f !== null) f(nodeOf(target), event);
    });
  }
  delegations.push(onEvent);
  dom.delegate(root.handle, delegations.length - 1, dom.atom(type));
}

/** From `target` up to `root` (not included), each node's handler for the delegated type `type`, until one cancels the bubble
 * (stopPropagation): the walk a delegating renderer makes. */
export function bubble(target: DomNode | null, root: DomNode, type: number, event: Event): void {
  let node = target;
  while (node !== null && node !== root) {
    const f = handlerOf(node, type);
    if (f !== null) {
      f(event);
      if (event.cancelBubble) break;
    }
    node = node.parentNode;
  }
}
