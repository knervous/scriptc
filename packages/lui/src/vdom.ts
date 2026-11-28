// The virtual tree and the DOM patcher of the LUI runtime. Every DOM operation goes through `#dom` (dom.ts on the page's
// own nodes, or dom-stream.ts over the DOM stream), so the patcher runs unchanged on either.
//
// One shape per type: every element carries the same Attrs record whatever its tag, children are VNode arrays, and
// event handlers are closures read through the node's current vnode, so a new closure each render costs nothing.

import {
  type LElement, type LNode, type LText, FIELD_INPUT, FIELD_NONE, FIELD_SELECT, appendChild, committed, createElement, createPortalContainer,
  createText, dispatchError, fieldChecked, fieldKind, fieldValue, firstChildOf, inSvg, insertBefore, isConnected, listen, nextSiblingOf,
  parentOf, removeAttribute, removeChild, removeNode as removeDomNode, replaceChild, setAttribute, setClass, setDefaultChecked,
  setFieldChecked, setFieldValue, setText, unlisten,
} from '#dom';

export type { LElement, LNode, LText };

/** One child as JSX writes it: a node, text, a number, or nothing (null, undefined, a boolean). */
export type Leaf = VNode | string | number | boolean | null | undefined;
/** A child: a leaf or a list of them (`{items}`). */
export type Child = Leaf | readonly Leaf[];
/** An element's children: one leaf or a list of children. Two levels and one list arm per union, not a recursive
 * type: the compiled backend tells union arms apart by kind, so a union holds at most one list type. */
export type Children = Leaf | readonly Child[];

/** The attributes and handlers an element may carry: one record type for every tag. */
export interface Attrs {
  class?: string;
  id?: string;
  style?: string;
  title?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  placeholder?: string;
  type?: string;
  href?: string;
  /** Before src: an image starts as a CORS load only if it is set first (cross-origin images under COEP require-corp). */
  crossorigin?: string;
  src?: string;
  alt?: string;
  tabIndex?: number;
  role?: string;
  hidden?: boolean;
  draggable?: boolean;
  'data-id'?: string;
  'data-slot'?: string;
  'data-state'?: string;
  'aria-label'?: string;
  'aria-hidden'?: string;
  'aria-pressed'?: string;
  'aria-expanded'?: string;
  /** Attributes the record does not name, as name/value pairs. */
  attrs?: readonly Attr[];
  /** A portal's own element to draw into (`portal`'s `into`: a window of its own); never set on the element. */
  portalInto?: LElement;
  onClick?: (event: MouseEvent) => void;
  onDblClick?: (event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  onMouseDown?: (event: MouseEvent) => void;
  onMouseUp?: (event: MouseEvent) => void;
  onMouseEnter?: (event: MouseEvent) => void;
  onMouseLeave?: (event: MouseEvent) => void;
  onMouseMove?: (event: MouseEvent) => void;
  onPointerDown?: (event: PointerEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onWheel?: (event: WheelEvent) => void;
  onDragStart?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
  onTouchStart?: (event: TouchEvent) => void;
  onTouchMove?: (event: TouchEvent) => void;
  onTouchEnd?: (event: TouchEvent) => void;
  onTouchCancel?: (event: TouchEvent) => void;
  /** An image (or other resource) failed to load. */
  onError?: (event: Event) => void;
  onLoad?: (event: Event) => void;
  /** A click in the capture phase, before the element's own and its children's click handlers. */
  onClickCapture?: (event: MouseEvent) => void;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;
  onPointerCancel?: (event: PointerEvent) => void;
  onPointerEnter?: (event: PointerEvent) => void;
  onPointerLeave?: (event: PointerEvent) => void;
  onKeyUp?: (event: KeyboardEvent) => void;
  onSubmit?: (event: SubmitEvent) => void;
  onScroll?: (event: Event) => void;
  /** A key in the capture phase (a window's handle nudges with the arrows before its children see them). */
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  /**
   * Called with the element as soon as it exists, before it is in the document: hosting a subtree, keeping a handle.
   * For anything that needs the element on the page (focus, measuring, a hosted renderer's layout), use onMount.
   */
  ref?: (element: LElement) => void;
  /** Called once, after the commit that created the element, with the element in the document (focus, measuring). */
  onMount?: (element: LElement) => void;
  /** Called after a patch kept the element for a new vnode (a hosted subtree re-renders). */
  onPatch?: (element: LElement) => void;
  /** Called when the element leaves the DOM, itself or with an ancestor (a hosted subtree unmounts). */
  onRemove?: (element: LElement) => void;
  children?: Children;
  /** A keyed sibling's key. Type checking only: the JSX transform passes it to jsx() apart from the attributes. */
  key?: string | number;
}

export interface Attr {
  readonly name: string;
  readonly value: string;
}

export interface VElement {
  readonly kind: 'element';
  readonly tag: string;
  /** A string key among keyed siblings, or null. */
  readonly key: string | null;
  /** A numeric key among keyed siblings (the common case: an id), or NaN. A vnode has at most one of the two. */
  readonly numKey: number;
  readonly attrs: Attrs;
  readonly children: readonly VNode[];
  /** lazy(): the argument this subtree was made from (the same argument gives the same subtree). */
  readonly lazyArg: object | null;
  /** Which handlers `attrs` has, one bit per HANDLERS entry (computed once, when the vnode is made). */
  readonly handlers: number;
  /** The handlers past the first word's 32 bits, one bit per HANDLERS_HI entry. */
  readonly handlersHi: number;
  /** The element this vnode was patched into (set by the runtime). */
  dom: LElement | null;
  /** The element's listener state, handed from vnode to vnode as the element is patched (null: no listener yet). */
  listener: Listener | null;
}

/** An element's one DOM listener and the vnode it reads: the vnode the element stands for now. */
export class Listener {
  readonly fn: (event: Event) => void;
  /** The capture-phase click listener (a separate function: both listeners see the event at the target). */
  readonly captureFn: (event: Event) => void;
  constructor(public vnode: VElement) {
    this.fn = (event: Event) => handleEvent(this, event);
    this.captureFn = (event: Event) => {
      const a = this.vnode.attrs;
      if (event.type === 'click' && a.onClickCapture !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onClickCapture(event as MouseEvent);
      else if (event.type === 'keydown' && a.onKeyDownCapture !== undefined && (event instanceof KeyboardEvent || elsewhere(event))) a.onKeyDownCapture(event as KeyboardEvent);
    };
  }
}

/** What runs after every handled DOM event: each live program flushes its pending patch (programs register). */
const afterEvent = new Set<AfterEvent>();

/** A registered after-event step (a class: a compiled Set holds no bare function values). */
export class AfterEvent {
  constructor(readonly run: () => void) {}
}

/** Runs `run` after every handled DOM event, until the returned function is called. */
export function onAfterEvent(run: () => void): () => void {
  const entry = new AfterEvent(run);
  afterEvent.add(entry);
  return () => {
    afterEvent.delete(entry);
  };
}

/**
 * Every live program's pending patch, now (React's flushSync): for a handler that needs the DOM its messages make
 * before it returns, such as a focus that must land inside the same user gesture.
 */
export function flushSync(): void {
  for (const entry of afterEvent) entry.run();
}

/**
 * A DOM event on an element: its handler runs, every program's pending patch flushes, then a controlled form field is
 * put back to its vnode's value if the event moved it (React's controlled inputs: a checkbox the model did not
 * change stays as the model says; a field the model did change already matches, so its caret is not disturbed).
 */
function handleEvent(state: Listener, event: Event): void {
  runHandler(state.vnode, event);
  for (const entry of afterEvent) entry.run();
  restoreControlled(state.vnode);
}

function restoreControlled(v: VElement): void {
  const e = v.dom, a = v.attrs;
  // Only a controlled field has anything to put back: skip asking the element what it is for the rest.
  if (e === null || (a.checked === undefined && a.value === undefined)) return;
  const kind = fieldKind(e);
  if (kind === FIELD_NONE) return;
  if (kind === FIELD_INPUT && a.checked !== undefined && fieldChecked(e) !== a.checked) setFieldChecked(e, a.checked);
  if (a.value !== undefined && fieldValue(e) !== a.value) setFieldValue(e, a.value);
}

export interface VText {
  readonly kind: 'text';
  readonly text: string;
  /** A null or boolean child's place among unkeyed siblings (an empty text node). */
  readonly hole: boolean;
  dom: LText | null;
}

export type VNode = VElement | VText;

const NO_ATTRS: Attrs = {};

/**
 * Development diagnostics (off by default, and never on in a release build): with them on, programs keep their recent
 * messages and the development JSX entry marks each element with its source (`data-lui-src="file:line"`).
 */
export const diagnostics = { enabled: false };
const NO_CHILDREN: readonly VNode[] = [];

/**
 * An element vnode; `children` are flattened (text and numbers become text nodes). A null or boolean child keeps its
 * place among unkeyed siblings as an empty text node, as React keeps its hole: a sibling that appears or vanishes
 * must not shift the others onto each other's elements (a stateful element patched into its neighbour keeps its
 * own state). Among keyed siblings the keys carry identity, and holes are dropped.
 */
export function h(tag: string, attrs: Attrs | null, children: Children, key: string | number | null = null): VElement {
  let list: VNode[] = [];
  flatten(children, list);
  if (list.some(isHole) && list.some(isKeyed)) list = list.filter((v) => !isHole(v));
  const a = attrs ?? NO_ATTRS;
  return { kind: 'element', tag, key: typeof key === 'string' ? key : null, numKey: typeof key === 'number' ? key : NaN,
    attrs: a, children: list.length === 0 ? NO_CHILDREN : list, lazyArg: null, handlers: handlerMask(a), handlersHi: handlerMaskHi(a), dom: null, listener: null };
}

/** The <body> containers of live portals, by their placeholder (each removed with its portal). */
const portalContainers = new Map<LElement, LElement>();

const PORTAL = 'lui-portal';

/**
 * Children drawn into <body> instead of here (React's createPortal): a layer above everything, a sheet, a list over
 * the page. In the tree it is a hidden <lui-portal> placeholder, so its siblings diff and move as usual; its
 * children live in a box-less container appended to <body> when it is created, patched with it, and removed with it.
 * `into` draws them into that element instead (a picture-in-picture window's body: listeners sit on each element, so
 * they answer in another document). A portal keeps the target it was created with: key it by the target.
 */
export function portal(children: Children, key: string | number | null = null, into: LElement | null = null): VElement {
  const onRemove = (element: LElement) => {
    const container = portalContainers.get(element);
    if (container !== undefined) removeDomNode(container);
    portalContainers.delete(element);
  };
  return h(PORTAL, into === null ? { hidden: true, onRemove } : { hidden: true, onRemove, portalInto: into }, children, key);
}

/** Where `v`'s children go: its portal container for a portal, else its element. */
function childHost(v: VElement, e: LElement): LElement {
  if (v.tag !== PORTAL) return e;
  let container = portalContainers.get(e);
  if (container === undefined) {
    container = createPortalContainer(v.attrs.portalInto ?? null);
    portalContainers.set(e, container);
  }
  return container;
}

/**
 * An adopting program's view (Program's `adopt`, Embedded): the children it draws straight into the element it was
 * given. Never created on its own.
 */
export function contents(children: Children): VElement {
  return h('#contents', null, children);
}

export function text(value: string): VText {
  return { kind: 'text', text: value, hole: false, dom: null };
}

function flatten(children: Children, out: VNode[]): void {
  if (isChildList(children)) {
    for (const c of children) flattenChild(c, out);
    return;
  }
  addLeaf(children, out);
}

function flattenChild(child: Child, out: VNode[]): void {
  if (isLeafList(child)) {
    for (const leaf of child) addLeaf(leaf, out);
    return;
  }
  addLeaf(child, out);
}

/** The hole a null or boolean child leaves (an empty text node of its own). */
const isHole = (v: VNode): boolean => v.kind === 'text' && v.hole;
const isKeyed = (v: VNode): boolean => v.kind === 'element' && (v.key !== null || !Number.isNaN(v.numKey));

function addLeaf(leaf: Leaf, out: VNode[]): void {
  if (leaf === null || leaf === undefined || typeof leaf === 'boolean') {
    out.push({ kind: 'text', text: '', hole: true, dom: null });
    return;
  }
  if (typeof leaf === 'string') { out.push(text(leaf)); return; }
  if (typeof leaf === 'number') { out.push(text(String(leaf))); return; }
  out.push(leaf);
}

/** Array.isArray as guards that also narrow readonly lists. */
function isChildList(children: Children): children is readonly Child[] {
  return Array.isArray(children);
}
function isLeafList(child: Child): child is readonly Leaf[] {
  return Array.isArray(child);
}

/**
 * Elm's Html.Lazy: `view(arg)`, rebuilt only when `arg` is a different object than last time under this key.
 * `memory` holds the previous render's subtrees by key; the caller swaps it for the new map after each view.
 */
export function lazy<A extends object>(key: number, arg: A, view: (arg: A) => VElement, memory: LazyMemory): VElement {
  const old = memory.previous.get(key);
  if (old !== undefined && old.lazyArg === arg) {
    memory.next.set(key, old);
    return old;
  }
  const made = view(arg);
  const node: VElement = { kind: 'element', tag: made.tag, key: null, numKey: key, attrs: made.attrs, children: made.children, lazyArg: arg,
    handlers: made.handlers, handlersHi: made.handlersHi, dom: null, listener: null };
  memory.next.set(key, node);
  return node;
}

/** The subtrees of one lazy list across renders, by numeric key (an id). */
export class LazyMemory {
  previous = new Map<number, VElement>();
  next = new Map<number, VElement>();
  /** Called once per render, after the view: this render's subtrees become the previous ones. */
  swap(): void {
    this.previous = this.next;
    this.next = new Map<number, VElement>();
  }
}

// ---- Events ----------------------------------------------------------------

type HandlerName = 'click' | 'dblclick' | 'contextmenu' | 'mousedown' | 'mouseup' | 'mouseenter' | 'mouseleave' | 'mousemove'
  | 'pointerdown' | 'keydown' | 'input' | 'change' | 'focus' | 'blur' | 'wheel' | 'dragstart' | 'dragover' | 'drop'
  | 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel' | 'error' | 'load'
  | 'pointermove' | 'pointerup' | 'pointercancel' | 'pointerenter' | 'pointerleave' | 'keyup';

/** The DOM events a handler field listens to, in bit order (bit i of VElement.handlers is HANDLERS[i]). */
const HANDLERS: readonly HandlerName[] = ['click', 'dblclick', 'contextmenu', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mousemove',
  'pointerdown', 'keydown', 'input', 'change', 'focus', 'blur', 'wheel', 'dragstart', 'dragover', 'drop',
  'touchstart', 'touchmove', 'touchend', 'touchcancel', 'error', 'load',
  'pointermove', 'pointerup', 'pointercancel', 'pointerenter', 'pointerleave', 'keyup'];
/** The capture-phase listeners' bits (after the HANDLERS bits): their own listener, registered with capture. */
const CLICK_CAPTURE_BIT = 1 << 30;
const KEYDOWN_CAPTURE_BIT = 1 << 31;

/** The handler bits of `attrs`, in HANDLERS order. */
function handlerMask(a: Attrs): number {
  let m = 0;
  if (a.onClick !== undefined) m |= 1;
  if (a.onDblClick !== undefined) m |= 1 << 1;
  if (a.onContextMenu !== undefined) m |= 1 << 2;
  if (a.onMouseDown !== undefined) m |= 1 << 3;
  if (a.onMouseUp !== undefined) m |= 1 << 4;
  if (a.onMouseEnter !== undefined) m |= 1 << 5;
  if (a.onMouseLeave !== undefined) m |= 1 << 6;
  if (a.onMouseMove !== undefined) m |= 1 << 7;
  if (a.onPointerDown !== undefined) m |= 1 << 8;
  if (a.onKeyDown !== undefined) m |= 1 << 9;
  if (a.onInput !== undefined) m |= 1 << 10;
  if (a.onChange !== undefined) m |= 1 << 11;
  if (a.onFocus !== undefined) m |= 1 << 12;
  if (a.onBlur !== undefined) m |= 1 << 13;
  if (a.onWheel !== undefined) m |= 1 << 14;
  if (a.onDragStart !== undefined) m |= 1 << 15;
  if (a.onDragOver !== undefined) m |= 1 << 16;
  if (a.onDrop !== undefined) m |= 1 << 17;
  if (a.onTouchStart !== undefined) m |= 1 << 18;
  if (a.onTouchMove !== undefined) m |= 1 << 19;
  if (a.onTouchEnd !== undefined) m |= 1 << 20;
  if (a.onTouchCancel !== undefined) m |= 1 << 21;
  if (a.onError !== undefined) m |= 1 << 22;
  if (a.onLoad !== undefined) m |= 1 << 23;
  if (a.onPointerMove !== undefined) m |= 1 << 24;
  if (a.onPointerUp !== undefined) m |= 1 << 25;
  if (a.onPointerCancel !== undefined) m |= 1 << 26;
  if (a.onPointerEnter !== undefined) m |= 1 << 27;
  if (a.onPointerLeave !== undefined) m |= 1 << 28;
  if (a.onKeyUp !== undefined) m |= 1 << 29;
  if (a.onClickCapture !== undefined) m |= CLICK_CAPTURE_BIT;
  if (a.onKeyDownCapture !== undefined) m |= KEYDOWN_CAPTURE_BIT;
  return m;
}

/** The DOM events of the second handler word, in bit order (bit i of VElement.handlersHi is HANDLERS_HI[i]). */
const HANDLERS_HI: readonly ('submit' | 'scroll')[] = ['submit', 'scroll'];

function handlerMaskHi(a: Attrs): number {
  let m = 0;
  if (a.onSubmit !== undefined) m |= 1;
  if (a.onScroll !== undefined) m |= 1 << 1;
  return m;
}

/**
 * An event from another window's document (an element drawn into a pop-up window): built from that window's classes,
 * so this window's `instanceof` refuses it, though its `type` says what it is as surely. Asked only when the
 * `instanceof` has already said no.
 */
function elsewhere(event: Event): boolean {
  return !(event instanceof Event);
}

/** Runs the handler `event` names on the vnode an element stands for now. */
function runHandler(v: VElement, event: Event): void {
  const a = v.attrs;
  switch (event.type) {
    case 'click': if (a.onClick !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onClick(event as MouseEvent); return;
    case 'dblclick': if (a.onDblClick !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onDblClick(event as MouseEvent); return;
    case 'contextmenu': if (a.onContextMenu !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onContextMenu(event as MouseEvent); return;
    case 'mousedown': if (a.onMouseDown !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onMouseDown(event as MouseEvent); return;
    case 'mouseup': if (a.onMouseUp !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onMouseUp(event as MouseEvent); return;
    case 'mouseenter': if (a.onMouseEnter !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onMouseEnter(event as MouseEvent); return;
    case 'mouseleave': if (a.onMouseLeave !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onMouseLeave(event as MouseEvent); return;
    case 'mousemove': if (a.onMouseMove !== undefined && (event instanceof MouseEvent || elsewhere(event))) a.onMouseMove(event as MouseEvent); return;
    case 'pointerdown': if (a.onPointerDown !== undefined && (event instanceof PointerEvent || elsewhere(event))) a.onPointerDown(event as PointerEvent); return;
    case 'keydown': if (a.onKeyDown !== undefined && (event instanceof KeyboardEvent || elsewhere(event))) a.onKeyDown(event as KeyboardEvent); return;
    case 'input': if (a.onInput !== undefined) a.onInput(event); return;
    case 'change': if (a.onChange !== undefined) a.onChange(event); return;
    case 'focus': if (a.onFocus !== undefined && (event instanceof FocusEvent || elsewhere(event))) a.onFocus(event as FocusEvent); return;
    case 'blur': if (a.onBlur !== undefined && (event instanceof FocusEvent || elsewhere(event))) a.onBlur(event as FocusEvent); return;
    case 'wheel': if (a.onWheel !== undefined && (event instanceof WheelEvent || elsewhere(event))) a.onWheel(event as WheelEvent); return;
    case 'dragstart': if (a.onDragStart !== undefined && (event instanceof DragEvent || elsewhere(event))) a.onDragStart(event as DragEvent); return;
    case 'dragover': if (a.onDragOver !== undefined && (event instanceof DragEvent || elsewhere(event))) a.onDragOver(event as DragEvent); return;
    case 'drop': if (a.onDrop !== undefined && (event instanceof DragEvent || elsewhere(event))) a.onDrop(event as DragEvent); return;
    case 'touchstart': if (a.onTouchStart !== undefined && (event instanceof TouchEvent || elsewhere(event))) a.onTouchStart(event as TouchEvent); return;
    case 'touchmove': if (a.onTouchMove !== undefined && (event instanceof TouchEvent || elsewhere(event))) a.onTouchMove(event as TouchEvent); return;
    case 'touchend': if (a.onTouchEnd !== undefined && (event instanceof TouchEvent || elsewhere(event))) a.onTouchEnd(event as TouchEvent); return;
    case 'touchcancel': if (a.onTouchCancel !== undefined && (event instanceof TouchEvent || elsewhere(event))) a.onTouchCancel(event as TouchEvent); return;
    case 'error': if (a.onError !== undefined) a.onError(event); return;
    case 'load': if (a.onLoad !== undefined) a.onLoad(event); return;
    case 'pointermove': if (a.onPointerMove !== undefined && (event instanceof PointerEvent || elsewhere(event))) a.onPointerMove(event as PointerEvent); return;
    case 'pointerup': if (a.onPointerUp !== undefined && (event instanceof PointerEvent || elsewhere(event))) a.onPointerUp(event as PointerEvent); return;
    case 'pointercancel': if (a.onPointerCancel !== undefined && (event instanceof PointerEvent || elsewhere(event))) a.onPointerCancel(event as PointerEvent); return;
    case 'pointerenter': if (a.onPointerEnter !== undefined && (event instanceof PointerEvent || elsewhere(event))) a.onPointerEnter(event as PointerEvent); return;
    case 'pointerleave': if (a.onPointerLeave !== undefined && (event instanceof PointerEvent || elsewhere(event))) a.onPointerLeave(event as PointerEvent); return;
    case 'keyup': if (a.onKeyUp !== undefined && (event instanceof KeyboardEvent || elsewhere(event))) a.onKeyUp(event as KeyboardEvent); return;
    case 'submit': if (a.onSubmit !== undefined && (event instanceof SubmitEvent || elsewhere(event))) a.onSubmit(event as SubmitEvent); return;
    case 'scroll': if (a.onScroll !== undefined) a.onScroll(event); return;
  }
}

/** Adds and removes the element's DOM listeners where the handler bits changed; `next` takes over the listener state. */
function syncListeners(e: LElement, old: VElement | null, next: VElement): void {
  const was = old === null ? 0 : old.handlers;
  const wasHi = old === null ? 0 : old.handlersHi;
  let state = old === null ? null : old.listener;
  if (state !== null) state.vnode = next;
  if (wasHi !== next.handlersHi) {
    if (state === null) state = new Listener(next);
    const changedHi = wasHi ^ next.handlersHi;
    for (let i = 0; i < HANDLERS_HI.length; i++) {
      if ((changedHi & (1 << i)) === 0) continue;
      if ((next.handlersHi & (1 << i)) !== 0) listen(e, HANDLERS_HI[i]!, state.fn, false);
      else unlisten(e, HANDLERS_HI[i]!, state.fn, false);
    }
  }
  if (was !== next.handlers) {
    if (state === null) state = new Listener(next);
    const fn = state.fn;
    const changed = was ^ next.handlers;
    for (let i = 0; i < HANDLERS.length; i++) {
      if ((changed & (1 << i)) === 0) continue;
      if ((next.handlers & (1 << i)) !== 0) listen(e, HANDLERS[i]!, fn, false);
      else unlisten(e, HANDLERS[i]!, fn, false);
    }
    if ((changed & CLICK_CAPTURE_BIT) !== 0) {
      if ((next.handlers & CLICK_CAPTURE_BIT) !== 0) listen(e, 'click', state.captureFn, true);
      else unlisten(e, 'click', state.captureFn, true);
    }
    if ((changed & KEYDOWN_CAPTURE_BIT) !== 0) {
      if ((next.handlers & KEYDOWN_CAPTURE_BIT) !== 0) listen(e, 'keydown', state.captureFn, true);
      else unlisten(e, 'keydown', state.captureFn, true);
    }
  }
  next.listener = state;
}

// ---- Attributes ------------------------------------------------------------

function setString(e: LElement, name: string, old: string | undefined, next: string | undefined): void {
  if (old === next) return;
  if (next === undefined) removeAttribute(e, name);
  else setAttribute(e, name, next);
}

/**
 * A host's say over URL attributes (`src`, `href`): a promise of the URL to use (an application whose assets must be
 * opened before an element can show them hands back an object URL). Without one, URLs are set as given.
 */
export type UrlResolver = (url: string) => Promise<string>;
let urlResolver: UrlResolver | null = null;
/** The URL each element's attribute was last asked for, so a late resolution never overwrites a newer one. */
const wantedUrls = new WeakMap<LElement, Map<string, string>>();

/** Install (or with null remove) the URL resolver. Call before mounting. */
export function setUrlResolver(next: UrlResolver | null): void {
  urlResolver = next;
}

function setUrl(e: LElement, name: string, old: string | undefined, next: string | undefined): void {
  if (old === next) return;
  let wanted = wantedUrls.get(e);
  if (next === undefined || urlResolver === null) {
    wanted?.delete(name);
    setString(e, name, old, next);
    return;
  }
  const resolved = urlResolver(next);
  if (!wanted) wantedUrls.set(e, (wanted = new Map()));
  wanted.set(name, next);
  removeAttribute(e, name);
  const current = () => wantedUrls.get(e)?.get(name) === next;
  resolved.then(
    (url) => { if (current()) { setAttribute(e, name, url); committed(); } },
    // The element's own error handling runs, as for a URL that failed to load.
    () => { if (current()) dispatchError(e); },
  );
}

function setFlag(e: LElement, name: string, old: boolean | undefined, next: boolean | undefined): void {
  if (old === next) return;
  if (next === true) setAttribute(e, name, '');
  else removeAttribute(e, name);
}

/** Applies `next` over `old` on `e`: only the fields that changed touch the DOM. */
function applyAttrs(e: LElement, old: Attrs, next: Attrs): void {
  if (old === next) return;
  // An input's type before its value (React's order): a range reused as a checkbox, its type changed after, has the
  // browser copy its live value into the value attribute as it leaves value mode.
  setString(e, 'type', old.type, next.type);
  if (old.class !== next.class) {
    if (next.class === undefined) removeAttribute(e, 'class');
    else setClass(e, next.class);
  }
  setString(e, 'id', old.id, next.id);
  setString(e, 'style', old.style, next.style);
  setString(e, 'title', old.title, next.title);
  if (old.value !== next.value) {
    // An input's live value is a property; the attribute only seeds it.
    const kind = fieldKind(e);
    if (kind !== FIELD_NONE) {
      const value = next.value ?? '';
      if (fieldValue(e) !== value) setFieldValue(e, value);
      // An input's attribute mirrors its value, as React keeps it (attribute selectors and the DOM read the same).
      if (kind === FIELD_INPUT) setString(e, 'value', old.value, next.value);
    } else {
      setString(e, 'value', old.value, next.value);
    }
  }
  if (old.checked !== next.checked) {
    if (fieldKind(e) === FIELD_INPUT) setFieldChecked(e, next.checked === true);
    else setFlag(e, 'checked', old.checked, next.checked);
  }
  // A new input's `checked` attribute is its first checked state, never updated after (React's initInput).
  if (old === NO_ATTRS && next.checked !== undefined && fieldKind(e) === FIELD_INPUT) setDefaultChecked(e, next.checked);
  setFlag(e, 'disabled', old.disabled, next.disabled);
  setString(e, 'placeholder', old.placeholder, next.placeholder);
  setUrl(e, 'href', old.href, next.href);
  setString(e, 'crossorigin', old.crossorigin, next.crossorigin);
  setUrl(e, 'src', old.src, next.src);
  setString(e, 'alt', old.alt, next.alt);
  if (old.tabIndex !== next.tabIndex) {
    if (next.tabIndex === undefined) removeAttribute(e, 'tabindex');
    else setAttribute(e, 'tabindex', String(next.tabIndex));
  }
  setString(e, 'role', old.role, next.role);
  setFlag(e, 'hidden', old.hidden, next.hidden);
  if (old.draggable !== next.draggable) {
    if (next.draggable === undefined) removeAttribute(e, 'draggable');
    else setAttribute(e, 'draggable', next.draggable ? 'true' : 'false');
  }
  setString(e, 'data-id', old['data-id'], next['data-id']);
  setString(e, 'data-slot', old['data-slot'], next['data-slot']);
  setString(e, 'data-state', old['data-state'], next['data-state']);
  setString(e, 'aria-label', old['aria-label'], next['aria-label']);
  setString(e, 'aria-hidden', old['aria-hidden'], next['aria-hidden']);
  setString(e, 'aria-pressed', old['aria-pressed'], next['aria-pressed']);
  setString(e, 'aria-expanded', old['aria-expanded'], next['aria-expanded']);
  if (old.attrs !== next.attrs) applyExtra(e, old.attrs ?? [], next.attrs ?? []);
  // An input's value again, after its type and min/max/step: set before them, a range input clamps it to the
  // defaults (0..100), so -2 on a -4..4 slider stuck at 0. React sets an input's value last for the same reason.
  // The attribute test first: asking the element what it is can be a host round trip, and this line runs for every
  // element of every patch.
  if (next.value !== undefined && fieldKind(e) === FIELD_INPUT && fieldValue(e) !== next.value) setFieldValue(e, next.value);
}

function applyExtra(e: LElement, old: readonly Attr[], next: readonly Attr[]): void {
  for (const o of old) {
    if (!next.some((n) => n.name === o.name)) removeAttribute(e, o.name);
  }
  for (const n of next) {
    const o = old.find((x) => x.name === n.name);
    if (o === undefined || o.value !== n.value) setAttribute(e, n.name, n.value);
  }
}

// ---- Creating and patching -------------------------------------------------

/** How many live elements have an onRemove: removals walk their subtree only while there are some. */
let removalWatchers = 0;

// ---- Commits ---------------------------------------------------------------
//
// A commit is one program building or patching its tree. Commits nest (an embedded program starts inside its host's
// patch), so the work that needs the finished DOM waits for the outermost one to end: onMount hooks, then the
// after-commit steps programs queued (program.ts, afterCommit).

/** An element waiting for its onMount (a class: a compiled Map holds no bare function values). */
class PendingMount {
  constructor(readonly element: LElement, readonly run: (element: LElement) => void) {}
}

/** A step to run once the current commit is in the DOM. */
export class CommitStep {
  constructor(readonly run: () => void) {}
}

const pendingMounts = new Map<LElement, PendingMount>();
const commitSteps: CommitStep[] = [];
let commitDepth = 0;

/** Runs `body` as a commit: when the outermost commit ends, mounts and queued steps run. */
export function commit(body: () => void): void {
  commitDepth++;
  try {
    body();
  } finally {
    commitDepth--;
    if (commitDepth === 0) endCommit();
  }
}

/** Queues `step` for the end of the current commit, or runs it now when none is open. */
export function afterCurrentCommit(step: CommitStep): void {
  if (commitDepth > 0) commitSteps.push(step);
  else step.run();
}

function endCommit(): void {
  // The DOM is current before anything that reads it runs (`#dom`'s committed: the DOM stream flushes here).
  committed();
  // An element created outside the document (a program whose root is not on the page yet) waits for a later commit.
  for (const [element, pending] of pendingMounts) {
    if (!isConnected(element)) continue;
    pendingMounts.delete(element);
    pending.run(element);
  }
  // Steps may send messages and so commit again: take the queue as it stands.
  const steps = commitSteps.splice(0, commitSteps.length);
  for (const step of steps) step.run();
  if (steps.length > 0 || pendingMounts.size > 0) committed();
}

/** Tells `v`'s subtree it left the DOM (onRemove, deepest first). */
function removed(v: VNode): void {
  if (v.kind === 'text') return;
  if (pendingMounts.size > 0 && v.dom !== null) pendingMounts.delete(v.dom);
  if (removalWatchers === 0 && pendingMounts.size === 0) return;
  for (const c of v.children) removed(c);
  const e = v.dom;
  if (v.attrs.onRemove !== undefined && e !== null) {
    removalWatchers--;
    v.attrs.onRemove(e);
  }
}

/** Removes `v`'s node from `parent`, telling its subtree. */
function removeNode(parent: LNode, v: VNode): void {
  const d = domOf(v);
  if (d === null) return;
  removeChild(parent, d);
  removed(v);
}

/** Disposes a whole tree (the program's): its subtree's onRemove hooks run. */
export function disposeTree(v: VNode): void {
  removed(v);
}

/**
 * Creates the DOM for `v` (and its subtree); `v` and its descendants take their nodes. `parent` is where it will be
 * inserted, which decides the namespace: an <svg> and everything inside it are SVG elements.
 */
/** A select's value names one of its options, so it is applied once they exist (and again when they change). */
function selectValue(e: LElement, a: Attrs): void {
  if (a.value === undefined || fieldKind(e) !== FIELD_SELECT) return;
  if (fieldValue(e) !== a.value) setFieldValue(e, a.value);
}

export function create(v: VNode, parent: LNode | null = null): LNode {
  if (v.kind === 'text') {
    const t = createText(v.text);
    v.dom = t;
    return t;
  }
  const e = createElement(v.tag, v.tag === 'svg' || inSvg(parent));
  applyAttrs(e, NO_ATTRS, v.attrs);
  syncListeners(e, null, v);
  const host = childHost(v, e);
  for (const c of v.children) appendChild(host, create(c, host));
  selectValue(e, v.attrs);
  v.dom = e;
  if (v.attrs.onRemove !== undefined) removalWatchers++;
  if (v.attrs.ref !== undefined) v.attrs.ref(e);
  if (v.attrs.onMount !== undefined) pendingMounts.set(e, new PendingMount(e, v.attrs.onMount));
  return e;
}

/**
 * Binds `v` to an element that already exists (an adopting program's host, made by another view): its attributes and
 * listeners are applied to it and its children created into it. `contents()` adds no attributes. Its ref and onMount
 * run as a created element's do: the root is the program's own element from here (a view that measures its root in
 * its ref must see that ref run).
 */
export function adopt(root: LElement, v: VElement): void {
  applyAttrs(root, NO_ATTRS, v.attrs);
  syncListeners(root, null, v);
  for (const c of v.children) appendChild(root, create(c, root));
  v.dom = root;
  if (v.attrs.ref !== undefined) v.attrs.ref(root);
  if (v.attrs.onMount !== undefined) pendingMounts.set(root, new PendingMount(root, v.attrs.onMount));
}

/** A vnode with no attributes and no handlers: what an adopted root goes back to. */
const RELEASED: VElement = h('#released', null, null);

/**
 * Undoes adopt(): the listeners and attributes `v` put on `root` leave with it (the root itself, and its place in the
 * parent's tree, stay the parent's). The children are the caller's to remove.
 */
export function release(root: LElement, v: VElement): void {
  applyAttrs(root, v.attrs, NO_ATTRS);
  syncListeners(root, v, RELEASED);
  v.listener = null;
}

/** Patches `old` (in the DOM) to look like `next`; `next` takes over its node. */
export function patch(old: VNode, next: VNode): void {
  if (old === next) return;
  if (old.kind === 'text') {
    const t = old.dom;
    if (next.kind === 'text') {
      if (t !== null && old.text !== next.text) setText(t, next.text);
      next.dom = t;
      return;
    }
    replace(old, next);
    return;
  }
  const e = old.dom;
  // Another key is another element, wherever it stands (React remounts on a changed key, keyed list or not).
  if (next.kind === 'element' && old.tag === next.tag && e !== null && sameKey(old, next)) {
    next.dom = e;
    applyAttrs(e, old.attrs, next.attrs);
    syncListeners(e, old, next);
    patchChildren(childHost(next, e), old.children, next.children);
    selectValue(e, next.attrs);
    // The removal hook moves to the vnode that now owns the element.
    if (old.attrs.onRemove !== undefined && next.attrs.onRemove === undefined) removalWatchers--;
    if (old.attrs.onRemove === undefined && next.attrs.onRemove !== undefined) removalWatchers++;
    // An element still waiting for its mount (made outside the document) mounts with the newest vnode's hook.
    if (pendingMounts.size > 0 && pendingMounts.has(e)) {
      if (next.attrs.onMount === undefined) pendingMounts.delete(e);
      else pendingMounts.set(e, new PendingMount(e, next.attrs.onMount));
    }
    if (next.attrs.onPatch !== undefined) next.attrs.onPatch(e);
    return;
  }
  replace(old, next);
}

function sameKey(a: VElement, b: VElement): boolean {
  return a.key === b.key && (a.numKey === b.numKey || (Number.isNaN(a.numKey) && Number.isNaN(b.numKey)));
}

function replace(old: VNode, next: VNode): void {
  const node = domOf(old);
  const parent = node === null ? null : parentOf(node);
  if (node !== null && parent !== null) {
    replaceChild(parent, create(next, parent), node);
    removed(old);
  }
}

function domOf(v: VNode): LNode | null {
  return v.kind === 'text' ? v.dom : v.dom;
}

function keyOf(v: VNode): string | null {
  return v.kind === 'element' ? v.key : null;
}

function numKeyOf(v: VNode): number {
  return v.kind === 'element' ? v.numKey : NaN;
}

/** Whether `o` stands where `n` does in a keyed list: both keyed elements, the same key and tag (patched in place). */
function sameSlot(o: VNode, n: VNode): boolean {
  return o.kind === 'element' && n.kind === 'element' && o.tag === n.tag && (o.key !== null || !Number.isNaN(o.numKey)) && sameKey(o, n);
}

/**
 * Children: keyed when the new first child carries a key (numeric or string), else by position. A keyed list first
 * patches its unchanged ends in place (the common case: rows updated, none moved), and only the middle that changed
 * goes through the key maps.
 */
function patchChildren(parent: LElement, old: readonly VNode[], next: readonly VNode[]): void {
  if (old === next) return;
  const numeric = next.length > 0 && !Number.isNaN(numKeyOf(next[0]!));
  const keyed = numeric || (next.length > 0 && keyOf(next[0]!) !== null);
  if (keyed) {
    let start = 0;
    const shortest = Math.min(old.length, next.length);
    while (start < shortest && sameSlot(old[start]!, next[start]!)) {
      patch(old[start]!, next[start]!);
      start++;
    }
    let oldEnd = old.length;
    let nextEnd = next.length;
    while (oldEnd > start && nextEnd > start && sameSlot(old[oldEnd - 1]!, next[nextEnd - 1]!)) {
      patch(old[oldEnd - 1]!, next[nextEnd - 1]!);
      oldEnd--;
      nextEnd--;
    }
    if (start === oldEnd && start === nextEnd) return;
    // The middle's walk starts after the kept head (the last element of the unchanged start); it ends at the kept tail.
    const head = start > 0 ? domOf(next[start - 1]!) : null;
    const oldMid = start === 0 && oldEnd === old.length ? old : old.slice(start, oldEnd);
    const nextMid = start === 0 && nextEnd === next.length ? next : next.slice(start, nextEnd);
    if (numeric) patchNumKeyed(parent, oldMid, nextMid, head);
    else patchStrKeyed(parent, oldMid, nextMid, head);
    return;
  }
  {
    const common = Math.min(old.length, next.length);
    for (let i = 0; i < common; i++) patch(old[i]!, next[i]!);
    for (let i = common; i < next.length; i++) appendChild(parent, create(next[i]!, parent));
    for (let i = common; i < old.length; i++) removeNode(parent, old[i]!);
    return;
  }
}

/**
 * The keyed diff over string keys, for the children after `head` (null: from the first), patchChildren having patched
 * the unchanged ends.
 */
function patchStrKeyed(parent: LElement, old: readonly VNode[], next: readonly VNode[], head: LNode | null): void {
  const byKey = new Map<string, VNode>();
  for (const o of old) {
    const k = keyOf(o);
    if (k !== null) byKey.set(k, o);
    else removeNode(parent, o); // An unkeyed child among keyed ones leaves.
  }
  // What leaves goes first, so it never sits in the walk below and forces moves. A key whose tag changed leaves too:
  // patched, it would be replaced in place behind the walk's cursor.
  const kept = new Map<string, string>();
  for (const n of next) {
    const k = keyOf(n);
    if (k !== null && n.kind === 'element') kept.set(k, n.tag);
  }
  for (const [k, gone] of byKey) {
    if (gone.kind === 'element' && kept.get(k) === gone.tag) continue;
    removeNode(parent, gone);
    byKey.delete(k);
  }
  // Walk the new order against the DOM's current order: reuse by key, move or create as needed.
  // After the removals above: the node after the kept head is now the middle's first survivor (or the kept tail).
  let cursor: LNode | null = head === null ? firstChildOf(parent) : nextSiblingOf(head);
  for (const n of next) {
    const k = keyOf(n);
    const o = k === null ? undefined : byKey.get(k);
    let node: LNode | null;
    if (o !== undefined && k !== null) {
      byKey.delete(k);
      patch(o, n);
      node = domOf(n);
    } else {
      node = create(n, parent);
    }
    if (node === null) continue;
    if (node === cursor) cursor = nextSiblingOf(cursor);
    else insertBefore(parent, node, cursor);
  }
}

/** The keyed diff over numeric keys (patchStrKeyed's walk, with number maps). */
function patchNumKeyed(parent: LElement, old: readonly VNode[], next: readonly VNode[], head: LNode | null): void {
  const byKey = new Map<number, VNode>();
  for (const o of old) {
    const k = numKeyOf(o);
    if (!Number.isNaN(k)) byKey.set(k, o);
    else removeNode(parent, o);
  }
  const kept = new Map<number, string>();
  for (const n of next) {
    const k = numKeyOf(n);
    if (!Number.isNaN(k) && n.kind === 'element') kept.set(k, n.tag);
  }
  for (const [k, gone] of byKey) {
    if (gone.kind === 'element' && kept.get(k) === gone.tag) continue;
    removeNode(parent, gone);
    byKey.delete(k);
  }
  // After the removals above: the node after the kept head is now the middle's first survivor (or the kept tail).
  let cursor: LNode | null = head === null ? firstChildOf(parent) : nextSiblingOf(head);
  for (const n of next) {
    const k = numKeyOf(n);
    const o = Number.isNaN(k) ? undefined : byKey.get(k);
    let node: LNode | null;
    if (o !== undefined) {
      byKey.delete(k);
      patch(o, n);
      node = domOf(n);
    } else {
      node = create(n, parent);
    }
    if (node === null) continue;
    if (node === cursor) cursor = nextSiblingOf(cursor);
    else insertBefore(parent, node, cursor);
  }
}
