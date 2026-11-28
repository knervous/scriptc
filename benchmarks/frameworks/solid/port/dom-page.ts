// The Solid port's DOM on the page's own nodes: every operation is a host call, as the published runtime's are. The
// per-call lane builds with this module as "solid-port-dom"; ./dom-stream.ts is the DOM stream's.

export type HNode = Node;
export type HElement = Element;
/** What render mounts into: a page element. */
export type MountableElement = Element;
export type Template = Node;

export const document: Document = globalThis.document;

/** A page element as the port's element (itself, here). */
export function adoptElement(el: Element): HElement {
  return el;
}
/** The port is done with a mount point (nothing to forget on the page). */
export function releaseElement(_el: HElement): void {}

export function makeTemplate(html: string): Template {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstChild!;
}
export function cloneTemplate(t: Template): HElement {
  return t.cloneNode(true) as Element;
}

export function createText(text: string): HNode {
  return document.createTextNode(text);
}
export function isText(n: HNode): boolean {
  return n.nodeType === 3;
}
export function textOf(n: HNode): string {
  return (n as Text).data;
}
export function setText(n: HNode, text: string): void {
  (n as Text).data = text;
}
export function setTextContent(n: HNode, text: string): void {
  n.textContent = text;
}
export function insertBefore(parent: HNode, child: HNode, ref: HNode | null): void {
  parent.insertBefore(child, ref);
}
export function appendChild(parent: HNode, child: HNode): void {
  parent.appendChild(child);
}
export function replaceChild(parent: HNode, child: HNode, old: HNode): void {
  parent.replaceChild(child, old);
}
export function removeNode(n: HNode): void {
  (n as ChildNode).remove();
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
  (el as Element).setAttribute(name, value);
}
export function removeAttributeOf(el: HNode, name: string): void {
  (el as Element).removeAttribute(name);
}
export function setClassName(el: HNode, value: string): void {
  (el as Element).className = value;
}

const delegated: Set<string> = new Set();

/** A delegated handler goes on its node as `$$<name>`, as Solid keeps it (one property write on the page). */
export function setHandler(node: HNode, name: string, handler: (e: Event) => void): void {
  (node as unknown as Record<string, unknown>)["$$" + name] = handler;
}

/** Solid's eventHandler: from the target up to the document, each node's handler for the event, until one cancels the
 * bubble. A disabled element's handler does not run (`node.disabled`, undefined where the element has none). */
function dispatch(e: Event): void {
  const key = "$$" + e.type;
  let node: Node | null = e.target as Node | null;
  while (node !== null && node !== document) {
    const handler = (node as unknown as Record<string, unknown>)[key];
    if (typeof handler === "function" && !(node as unknown as { readonly disabled?: unknown }).disabled) {
      (handler as (e: Event) => void)(e);
      if (e.cancelBubble) return;
    }
    node = node.parentNode;
  }
}

export function delegate(names: string[]): void {
  for (const name of names) {
    if (delegated.has(name)) continue;
    delegated.add(name);
    document.addEventListener(name, dispatch);
  }
}

/** The end of an outermost update: nothing is pending on the page. */
export function flushAfterUpdates(): void {}
