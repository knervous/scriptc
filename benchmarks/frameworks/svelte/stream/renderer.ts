// A Svelte custom renderer (svelte/renderer's Renderer) whose nodes are the DOM stream's compiled nodes (packages/dom-stream):
// Svelte's DOM operations become stream commands, replayed by the page at the next flush, and its reads of structure and text
// are fields of the compiled-side mirror. Two methods go beyond Svelte's Renderer type (../PATCHES.md): templates are parsed once
// and cloned with one command (parseTree, cloneTree), where Svelte otherwise builds every node of every clone one call at a time.
//
// The flush rule (../PATCHES.md): Svelte writes the DOM when it flushes its batch, in a microtask after the change. Each
// delegated event queues one microtask, which runs Svelte's flushSync and then flushes the stream; the entry settles the same
// way after each change it makes. So the page is exact once Svelte has nothing pending.
import {
  type DomDocument, type DomElement, type DomNode, type DomTemplate, type DomText, COMMENT_NODE, DOCUMENT_FRAGMENT_NODE,
  ELEMENT_NODE, TEXT_NODE, adoptNode, bubble, cloneTemplate, delegate, delegatedType, domTemplate, flushDom, page, release as releaseNode,
  releaseTree, setHandler,
} from "dom-stream/dom";

let pageDocument: DomDocument | null = null;
function doc(): DomDocument {
  let d = pageDocument;
  if (d === null) {
    d = adoptNode(globalThis.document) as DomDocument;
    pageDocument = d;
  }
  return d;
}

/** Svelte's flushSync, set by the entry (the renderer cannot import Svelte, which imports it). */
let flushSvelte: () => void = () => {};
export function setFlushSync(f: () => void): void {
  flushSvelte = f;
}

/** Nodes Svelte removed since the last flush point. */
const removed: DomNode[] = [];

/** Svelte's pending work, then the removed nodes that stayed detached leave both tables, then the stream. */
function flushAll(): void {
  flushSvelte();
  for (let i = 0; i < removed.length; i++) {
    const n = removed[i]!;
    if (n.parentNode === null) releaseTree(n);
  }
  removed.length = 0;
  flushDom();
}

let flushQueued = false;
function queueFlush(): void {
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    flushAll();
  });
}

const delegatedTypes: Set<string> = new Set();
function ensureDelegated(type: string): void {
  if (delegatedTypes.has(type)) return;
  delegatedTypes.add(type);
  const root = doc();
  const index = delegatedType(type);
  delegate(root, type, (target: DomNode | null, event: Event): void => {
    bubble(target, root, index, event);
    queueFlush();
  });
}

/** Svelte's template structure: a text, a comment (`undefined`, or `['// data']`), or `[name, attributes, ...children]`. */
type TreeItem = string | undefined | unknown[];

const escapeText = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttribute = (s: string): string => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

function treeHtml(items: unknown[]): string {
  let html = "";
  for (const raw of items) {
    const item = raw as TreeItem;
    if (typeof item === "string") {
      html += escapeText(item);
      continue;
    }
    if (item === undefined) {
      html += "<!---->";
      continue;
    }
    const name = item[0] as string;
    if (name.startsWith("//")) {
      html += `<!--${name.slice(3)}-->`;
      continue;
    }
    html += "<" + name;
    const attributes = item[1] as Record<string, unknown> | null | undefined;
    if (attributes != null) {
      for (const key of Object.keys(attributes)) {
        const v = attributes[key];
        html += v === "" || v === true ? ` ${key}` : ` ${key}="${escapeAttribute(String(v))}"`;
      }
    }
    html += ">" + treeHtml(item.slice(2)) + `</${name}>`;
  }
  return html;
}

type NodeKind = "fragment" | "element" | "text" | "comment";

const renderer = {
  createFragment(): DomNode {
    return doc().createDocumentFragment();
  },
  createElement(name: string): DomNode {
    return doc().createElement(name);
  },
  createText(data: string): DomNode {
    return doc().createTextNode(data);
  },
  createComment(data: string): DomNode {
    return doc().createComment(data);
  },
  getNodeType(node: DomNode): NodeKind {
    const t = node.nodeType;
    return t === ELEMENT_NODE ? "element" : t === TEXT_NODE ? "text" : t === COMMENT_NODE ? "comment" : "fragment";
  },
  getText(node: DomNode): string | null {
    return node.nodeType === TEXT_NODE || node.nodeType === COMMENT_NODE ? (node as DomText).data : null;
  },
  /** Attributes live on the page: a read flushes and asks it (Svelte reads them only off the hot paths). */
  getAttribute(element: DomNode, name: string): string | null {
    return (page(element) as Element).getAttribute(name);
  },
  setAttribute(element: DomNode, key: string, value: unknown): void {
    if (value == null) (element as DomElement).removeAttribute(key);
    else (element as DomElement).setAttribute(key, String(value));
  },
  removeAttribute(element: DomNode, name: string): void {
    (element as DomElement).removeAttribute(name);
  },
  hasAttribute(element: DomNode, name: string): boolean {
    return (page(element) as Element).hasAttribute(name);
  },
  setText(node: DomNode, text: string): void {
    (node as DomText).setNodeValue(text);
  },
  getFirstChild(element: DomNode): DomNode | null {
    return element.firstChild;
  },
  getLastChild(element: DomNode): DomNode | null {
    return element.lastChild;
  },
  getNextSibling(node: DomNode): DomNode | null {
    return node.nextSibling;
  },
  insert(parent: DomNode, node: DomNode, anchor: DomNode | null): void {
    parent.insertBefore(node, anchor);
  },
  /** A node Svelte removes leaves both node tables at the next flush point if it is still detached then (Svelte inserts
   * some removed nodes again at once, as an each block's anchor after a clear). */
  remove(node: DomNode): void {
    node.remove();
    removed.push(node);
  },
  getParent(node: DomNode): DomNode | null {
    return node.parentNode;
  },
  /** Every listener is delegated: one page listener per type on the document, and the handler in a slot of its node. */
  addEventListener(target: DomNode, type: string, handler: (event: Event) => void): void {
    ensureDelegated(type);
    setHandler(target, delegatedType(type), handler);
  },
  removeEventListener(target: DomNode, type: string): void {
    setHandler(target, delegatedType(type), null);
  },
  /** Beyond Svelte's Renderer: a template's structure as HTML the page parses once. */
  parseTree(structure: unknown[]): DomTemplate {
    return domTemplate(treeHtml(structure));
  },
  /** Beyond Svelte's Renderer: a clone of a parsed template in one command (a fragment when Svelte asks for one). */
  cloneTree(template: DomTemplate, fragment: boolean): DomNode {
    const clone = cloneTemplate(template, doc());
    if (!fragment || clone.nodeType === DOCUMENT_FRAGMENT_NODE) return clone;
    const f = doc().createDocumentFragment();
    f.appendChild(clone);
    return f;
  },
};

export default renderer;

/** A page element as a mount target. */
export function target(el: Element): DomNode {
  return adoptNode(el);
}

/** The bridge forgets a mount target (the page element stays the page's). */
export function release(node: DomNode): void {
  releaseNode(node);
}

/** Runs Svelte's pending work, then the stream: the page is up to date when this returns. */
export function settle(): void {
  flushAll();
}
