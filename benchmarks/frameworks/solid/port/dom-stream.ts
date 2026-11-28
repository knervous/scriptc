// The Solid port's DOM on the DOM stream (packages/dom-stream): nodes are the bridge's compiled nodes, every change is a
// command replayed by the page at the next flush, and every read of structure or text is a field of the compiled-side mirror.
// The stream lane builds with this module as "solid-port-dom"; ./dom-page.ts is the per-call one.
//
// The flush rule: Solid writes the DOM synchronously, in an update (runUpdates) or an event handler. The stream is flushed at
// the end of the outermost update, unless a delegated event is being dispatched, and at the end of each delegated dispatch.
// Nothing else reads the page between those points, so the page is exact whenever page code can run.
//
// A node Solid's DOM code removes (remove, a replaced child, textContent) is released from both node tables: Solid's DOM code
// never inserts a removed node again in this program. A program that keeps a node and inserts it again would keep it instead.
import {
  type DomDocument, type DomElement, type DomNode, type DomTemplate, type DomText, TEXT_NODE, adoptNode, bubble, cloneTemplate as clone,
  delegate as delegateOnPage, delegatedType, domTemplate, flushDom, release, releaseTree, setHandler as setNodeHandler,
} from "dom-stream/dom";

export type HNode = DomNode;
export type HElement = DomNode;
/** What render mounts into: a page element, adopted into the bridge. */
export type MountableElement = Element;
export type Template = DomTemplate;

let pageDocument: DomDocument | null = null;
function documentNode(): DomDocument {
  let d = pageDocument;
  if (d === null) {
    d = adoptNode(globalThis.document) as DomDocument;
    pageDocument = d;
  }
  return d;
}

export function adoptElement(el: Element): HElement {
  return adoptNode(el);
}
/** The port is done with a mount point: the bridge forgets it (the page element stays the page's). */
export function releaseElement(el: HElement): void {
  release(el);
}

export function makeTemplate(html: string): Template {
  return domTemplate(html);
}
export function cloneTemplate(t: Template): HElement {
  return clone(t, documentNode());
}

export function createText(text: string): HNode {
  return documentNode().createTextNode(text);
}
export function isText(n: HNode): boolean {
  return n.nodeType === TEXT_NODE;
}
export function textOf(n: HNode): string {
  return (n as DomText).data;
}
export function setText(n: HNode, text: string): void {
  (n as DomText).setNodeValue(text);
}
/** textContent = text. The text node is made here, so this side knows it (Solid then writes its data in place). */
export function setTextContent(n: HNode, text: string): void {
  let c = n.firstChild;
  if (c !== null || !n.childrenKnown) n.setTextContent("");
  while (c !== null) {
    const next = c.nextSibling;
    releaseTree(c);
    c = next;
  }
  if (text !== "") n.appendChild(createText(text));
}
export function insertBefore(parent: HNode, child: HNode, ref: HNode | null): void {
  parent.insertBefore(child, ref);
}
export function appendChild(parent: HNode, child: HNode): void {
  parent.appendChild(child);
}
export function replaceChild(parent: HNode, child: HNode, old: HNode): void {
  parent.insertBefore(child, old);
  parent.removeChild(old);
  releaseTree(old);
}
export function removeNode(n: HNode): void {
  n.remove();
  releaseTree(n);
}
export function parentOf(n: HNode): HNode | null {
  return n.parentNode;
}
export function firstChildOf(n: HNode): HNode | null {
  return n.firstChild;
}
export function nextSiblingOf(n: HNode): HNode | null {
  return n.nextSibling;
}
export function setAttributeOf(el: HNode, name: string, value: string): void {
  (el as DomElement).setAttribute(name, value);
}
export function removeAttributeOf(el: HNode, name: string): void {
  (el as DomElement).removeAttribute(name);
}
export function setClassName(el: HNode, value: string): void {
  (el as DomElement).setPropString("className", value);
}

/** A delegated handler goes on its node (Solid's `$$<name>` property): a slot of the compiled node. */
export function setHandler(node: HNode, name: string, handler: (e: Event) => void): void {
  setNodeHandler(node, delegatedType(name), handler);
}

let dispatching = false;
const delegated: Set<string> = new Set();

/** Solid's delegateEvents: one listener per event type on the document. Its eventHandler walks from the target up, calling
 * each node's handler until one cancels the bubble (bubble). This program disables no element, so Solid's `disabled` test
 * always passes. */
export function delegate(names: string[]): void {
  const root = documentNode();
  for (const name of names) {
    if (delegated.has(name)) continue;
    delegated.add(name);
    const type = delegatedType(name);
    delegateOnPage(root, name, (target: DomNode | null, event: Event): void => {
      dispatching = true;
      try {
        bubble(target, root, type, event);
      } finally {
        dispatching = false;
        flushDom();
      }
    });
  }
}

/** The end of an outermost update: the page catches up, unless a delegated dispatch will flush when it ends. */
export function flushAfterUpdates(): void {
  if (!dispatching) flushDom();
}
