// LUI's DOM, on the page's own nodes: every DOM operation the patcher (vdom.ts) and programs (program.ts) make goes
// through these functions. This is the default `#dom`; `dom-stream.ts` is the same surface over a batched DOM bridge
// (packages/dom-stream), chosen with the `dom-stream` import condition.

export type LNode = Node;
export type LElement = Element;
export type LText = Text;

const SVG_NS = 'http://www.w3.org/2000/svg';
// The page's globals, read once, on first use (each read of a global from compiled code is a host call, and a page
// with no DOM, such as static rendering under Node, never reads them).
let pageDocument: Document | null = null;
let svgClass: typeof SVGElement | null = null;
let htmlClass: typeof HTMLElement | null = null;
const page = (): Document => (pageDocument ??= document);
const SvgElement = (): typeof SVGElement => (svgClass ??= SVGElement);
const HtmlElement = (): typeof HTMLElement => (htmlClass ??= HTMLElement);

export function createElement(tag: string, svg: boolean): LElement {
  return svg ? page().createElementNS(SVG_NS, tag) : page().createElement(tag);
}
export function createText(text: string): LText {
  return page().createTextNode(text);
}
/** A box-less container for a portal's children, appended to `into` (null: the document's body). */
export function createPortalContainer(into: LElement | null): LElement {
  const target = into ?? page().body;
  const container = target.ownerDocument.createElement('div');
  container.setAttribute('style', 'display: contents');
  target.appendChild(container);
  return container;
}

export function setAttribute(e: LElement, name: string, value: string): void {
  e.setAttribute(name, value);
}
export function removeAttribute(e: LElement, name: string): void {
  e.removeAttribute(name);
}
/** class = value: the property on an HTML element, the attribute elsewhere (an SVG element's className is no string). */
export function setClass(e: LElement, value: string): void {
  if (e instanceof HtmlElement()) e.className = value;
  else e.setAttribute('class', value);
}
export function setText(t: LText, text: string): void {
  t.nodeValue = text;
}

/** Whether children made under `parent` are SVG elements (inside an <svg>, outside a <foreignObject>). */
export function inSvg(parent: LNode | null): boolean {
  return parent instanceof SvgElement() && parent.tagName !== 'foreignObject';
}

export function appendChild(parent: LNode, child: LNode): void {
  parent.appendChild(child);
}
export function insertBefore(parent: LNode, child: LNode, before: LNode | null): void {
  parent.insertBefore(child, before);
}
export function removeChild(parent: LNode, child: LNode): void {
  parent.removeChild(child);
}
export function replaceChild(parent: LNode, child: LNode, old: LNode): void {
  parent.replaceChild(child, old);
}
/** `n` out of the tree (a portal's container). */
export function removeNode(n: LElement): void {
  n.remove();
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
export function isConnected(e: LElement): boolean {
  return e.isConnected;
}
export function contains(outer: LElement, inner: LElement): boolean {
  return outer.contains(inner);
}

export function listen(e: LElement, type: string, fn: (event: Event) => void, capture: boolean): void {
  e.addEventListener(type, fn, capture);
}
export function unlisten(e: LElement, type: string, fn: (event: Event) => void, capture: boolean): void {
  e.removeEventListener(type, fn, capture);
}
/** An error event on `e` (a URL resolution that failed, as a load that failed would). */
export function dispatchError(e: LElement): void {
  e.dispatchEvent(new Event('error'));
}

// Form fields: their live value and checked state are properties; the attributes only seed them.

/** What kind of form field `e` is: an input, a textarea or select (a value and no checked state), or none. */
export const FIELD_NONE = 0, FIELD_INPUT = 1, FIELD_TEXT = 2, FIELD_SELECT = 3;
export function fieldKind(e: LElement): number {
  return e instanceof HTMLInputElement ? FIELD_INPUT : e instanceof HTMLTextAreaElement ? FIELD_TEXT : e instanceof HTMLSelectElement ? FIELD_SELECT : FIELD_NONE;
}
export function fieldValue(e: LElement): string {
  return (e as HTMLInputElement).value;
}
export function setFieldValue(e: LElement, value: string): void {
  (e as HTMLInputElement).value = value;
}
export function fieldChecked(e: LElement): boolean {
  return (e as HTMLInputElement).checked;
}
export function setFieldChecked(e: LElement, checked: boolean): void {
  (e as HTMLInputElement).checked = checked;
}
export function setDefaultChecked(e: LElement, checked: boolean): void {
  (e as HTMLInputElement).defaultChecked = checked;
}

/** The end of an outermost commit: the page already has every change. */
export function committed(): void {}

/** The page element a program mounts into, as LUI's element (itself, here). */
export function mountPoint(e: Element): LElement {
  return e;
}
