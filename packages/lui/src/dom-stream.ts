// LUI's DOM over the DOM stream (packages/dom-stream): the `#dom` of a WasmGC build that sets the `dom-stream` import
// condition. Nodes are the bridge's compiled nodes; every change is a command the page replays at the next flush, and
// reads of structure are fields of the compiled-side mirror, answered with no call.
//
// The flush point: LUI changes the DOM only inside a commit (vdom.ts `commit`), so the stream is flushed when the
// outermost commit ends, before its onMount hooks and after-commit steps run, and again after them if they ran. A
// handled DOM event flushes its programs' patches before it returns (onAfterEvent), so the page is exact by then too.
//
// A node LUI removes (removeChild, a replaced child) is released from both node tables: LUI never inserts a removed node
// again (its vnode is gone with it).
import {
  type DomDocument, type DomElement, type DomNode, type DomText, ELEMENT_NODE, LISTEN_CAPTURE, adoptNode, flushDom, listen as listenOnPage,
  page, releaseTree, unlisten as unlistenOnPage,
} from './stream/dom-stream/src/dom';

export type LNode = DomNode;
export type LElement = DomNode;
export type LText = DomNode;

const SVG_NS = 'http://www.w3.org/2000/svg';

let pageDocument: DomDocument | null = null;
function doc(): DomDocument {
  let d = pageDocument;
  if (d === null) {
    d = adoptNode(globalThis.document) as DomDocument;
    pageDocument = d;
  }
  return d;
}

export function createElement(tag: string, svg: boolean): LElement {
  return svg ? doc().createElementNS(SVG_NS, tag) : doc().createElement(tag);
}
export function createText(text: string): LText {
  return doc().createTextNode(text);
}
export function createPortalContainer(into: LElement | null): LElement {
  const target = into ?? adoptNode(globalThis.document.body);
  const container = doc().createElement('div');
  container.setAttribute('style', 'display: contents');
  target.appendChild(container);
  return container;
}

export function setAttribute(e: LElement, name: string, value: string): void {
  (e as DomElement).setAttribute(name, value);
}
export function removeAttribute(e: LElement, name: string): void {
  (e as DomElement).removeAttribute(name);
}
export function setClass(e: LElement, value: string): void {
  const el = e as DomElement;
  if (el.namespaceURI === SVG_NS) el.setAttribute('class', value);
  else el.setPropString('className', value);
}
export function setText(t: LText, text: string): void {
  (t as DomText).setNodeValue(text);
}

export function inSvg(parent: LNode | null): boolean {
  if (parent === null || parent.nodeType !== ELEMENT_NODE) return false;
  const el = parent as DomElement;
  return el.namespaceURI === SVG_NS && el.localName !== 'foreignObject';
}

export function appendChild(parent: LNode, child: LNode): void {
  parent.appendChild(child);
}
export function insertBefore(parent: LNode, child: LNode, before: LNode | null): void {
  parent.insertBefore(child, before);
}
export function removeChild(parent: LNode, child: LNode): void {
  parent.removeChild(child);
  releaseTree(child);
}
export function replaceChild(parent: LNode, child: LNode, old: LNode): void {
  parent.insertBefore(child, old);
  parent.removeChild(old);
  releaseTree(old);
}
export function removeNode(n: LElement): void {
  n.remove();
  releaseTree(n);
}
export function parentOf(n: LNode): LNode | null {
  return n.parentNode;
}
export function firstChildOf(n: LNode): LNode | null {
  return n.firstChild;
}
export function nextSiblingOf(n: LNode): LNode | null {
  return n.nextSibling;
}
/** In the document: under a node adopted from the page (a mount point, which is in it), as far as this side knows. */
export function isConnected(e: LElement): boolean {
  let n: DomNode | null = e;
  while (n.parentNode !== null) n = n.parentNode;
  return n.pageNode !== null;
}
export function contains(outer: LElement, inner: LElement): boolean {
  return outer.contains(inner);
}

/** One of an element's listeners on the page: its type, function and phase, and the listen index for unlisten. */
class PageListener {
  constructor(readonly type: string, readonly fn: (event: Event) => void, readonly capture: boolean, readonly index: number) {}
}
/** An element's listeners, kept in the bridge node's renderer slot (`internals`), so they go with the node. */
class PageListeners {
  readonly list: PageListener[] = [];
}

export function listen(e: LElement, type: string, fn: (event: Event) => void, capture: boolean): void {
  const index = listenOnPage(e, type, fn, capture ? LISTEN_CAPTURE : 0);
  let own = e.internals as PageListeners | null;
  if (own === null) {
    own = new PageListeners();
    e.internals = own;
  }
  own.list.push(new PageListener(type, fn, capture, index));
}
export function unlisten(e: LElement, type: string, fn: (event: Event) => void, capture: boolean): void {
  const own = e.internals as PageListeners | null;
  if (own === null) return;
  const list = own.list;
  for (let i = 0; i < list.length; i++) {
    const l = list[i]!;
    if (l.type === type && l.fn === fn && l.capture === capture) {
      unlistenOnPage(e, l.index);
      list.splice(i, 1);
      return;
    }
  }
}
export function dispatchError(e: LElement): void {
  page(e).dispatchEvent(new Event('error'));
}

// Form fields: the live state is the page's, so a read flushes and asks it (LUI reads it only for controlled fields).
export const FIELD_NONE = 0, FIELD_INPUT = 1, FIELD_TEXT = 2, FIELD_SELECT = 3;
export function fieldKind(e: LElement): number {
  if (e.nodeType !== ELEMENT_NODE) return FIELD_NONE;
  const el = e as DomElement;
  if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return FIELD_NONE;
  const tag = el.localName;
  return tag === 'input' ? FIELD_INPUT : tag === 'textarea' ? FIELD_TEXT : tag === 'select' ? FIELD_SELECT : FIELD_NONE;
}
export function fieldValue(e: LElement): string {
  return (page(e) as HTMLInputElement).value;
}
export function setFieldValue(e: LElement, value: string): void {
  (e as DomElement).setPropString('value', value);
}
export function fieldChecked(e: LElement): boolean {
  return (page(e) as HTMLInputElement).checked;
}
export function setFieldChecked(e: LElement, checked: boolean): void {
  (e as DomElement).setPropBool('checked', checked);
}
export function setDefaultChecked(e: LElement, checked: boolean): void {
  (e as DomElement).setPropBool('defaultChecked', checked);
}

/** The end of an outermost commit: the page catches up. */
export function committed(): void {
  flushDom();
}

/** A page element a program mounts into, adopted into the bridge. */
export function mountPoint(e: Element): LElement {
  return adoptNode(e);
}
