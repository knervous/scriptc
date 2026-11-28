// The page's half of the DOM bridge (src/dom.ts): the node table, the replay of the DOM stream (dom.schema.json), and the calls that
// answer at once (`host:dom`).
//
// Focus and selection: a renderer that writes its commit into the stream (React DOM) brackets it with beginCommit and endCommit. The page
// has not yet seen the commit's mutations when it runs beginCommit, so it notes the focused element and its selection there, as React's
// prepareForCommit reads them, and restores them at endCommit as React's resetAfterCommit does. Nothing is read back across the seam.
import { createHostStreams } from "../../host-stream/src/host.js";
import { DOM_CHANNEL, replayDom } from "./dom-stream.generated.js";

const HANDLE = Symbol("dom-stream handle");
const LISTENERS = Symbol("dom-stream listeners");
/** addEventListener's options by listen flags (capture 1, passive 2, explicitly active 4). */
const OPTIONS = Array.from({ length: 8 }, (_, f) => Object.freeze({ capture: (f & 1) !== 0, passive: (f & 2) !== 0 }));
const noop = () => {};

/**
 * @param {object} [options]
 * @param {() => WebAssembly.Memory | undefined} [options.memory] the module's memory, once instantiated
 * @param {ReturnType<typeof createHostStreams>} [options.streams] streams to share with other channels
 */
export function createDomHost(options = {}) {
  const streams = options.streams ?? createHostStreams(options.memory);
  /** Page nodes by handle. */
  const table = [null];
  const at = (h) => {
    const n = table[h];
    if (n == null) throw new Error(`dom-stream: no node ${h}`);
    return n;
  };
  const enter = (h, node) => { table[h] = node; node[HANDLE] = h; };
  /** Where forwarders send events (host:dom events). A node's forwarders are on the node (LISTENERS), by listener index. */
  let dispatchEvent = () => {};
  /** A node's listener on the page: one object, the listener itself (handleEvent) and what unlisten needs. It forwards only while
   * the node still has its handle: once freed (the handle may name another node), it forwards nothing. */
  class Forwarder {
    constructor(node, h, index, type, capture) { this.node = node; this.h = h; this.index = index; this.type = type; this.capture = capture; }
    handleEvent(event) { if (this.node[HANDLE] === this.h) dispatchEvent(this.h, this.index, event); }
  }
  /** Where delegated events go (host:dom delegated). */
  let dispatchDelegated = () => {};
  /** Templates by id (host:dom template): the node a clone copies, an element or a fragment. */
  const templates = [null];
  /** What beginCommit noted: the focused element and its selection, per root (nested commits of two roots do not interleave). */
  let noted = null;

  const handlers = {
    createElement(h, doc, tag) { enter(h, (doc ? at(doc) : document).createElement(tag)); },
    createElementNS(h, doc, ns, tag) { enter(h, (doc ? at(doc) : document).createElementNS(ns, tag)); },
    createElementIs(h, doc, tag, is) { enter(h, (doc ? at(doc) : document).createElement(tag, { is })); },
    createText(h, doc, text) { enter(h, (doc ? at(doc) : document).createTextNode(text)); },
    createFragment(h, doc) { enter(h, (doc ? at(doc) : document).createDocumentFragment()); },
    createComment(h, doc, text) { enter(h, (doc ? at(doc) : document).createComment(text)); },
    appendChild(parent, child) { at(parent).appendChild(at(child)); },
    insertBefore(parent, child, before) { at(parent).insertBefore(at(child), at(before)); },
    removeChild(parent, child) { at(parent).removeChild(at(child)); },
    setAttribute(h, name, value) { at(h).setAttribute(name, value); },
    setAttributeNS(h, ns, name, value) { at(h).setAttributeNS(ns, name, value); },
    removeAttribute(h, name) { at(h).removeAttribute(name); },
    setNodeValue(h, text) { at(h).nodeValue = text; },
    setTextContent(h, text) {
      // React's setTextContent: a lone text child keeps its node.
      const node = at(h);
      if (text) {
        const first = node.firstChild;
        if (first && first === node.lastChild && first.nodeType === 3) { first.nodeValue = text; return; }
      }
      node.textContent = text;
    },
    setStyle(h, name, value) {
      const style = at(h).style;
      if (name.charCodeAt(0) === 45 && name.charCodeAt(1) === 45) style.setProperty(name, value);
      else if (name === "float") style.cssFloat = value;
      else style[name] = value;
    },
    removeStyle(h, name) {
      const style = at(h).style;
      if (name.charCodeAt(0) === 45 && name.charCodeAt(1) === 45) style.removeProperty(name);
      else if (name === "float") style.cssFloat = "";
      else style[name] = "";
    },
    setStyleProperty(h, name, value, priority) { at(h).style.setProperty(name, value, priority); },
    setPropString(h, name, value) { at(h)[name] = value; },
    setPropNumber(h, name, value) { at(h)[name] = value; },
    setPropBool(h, name, value) { at(h)[name] = value; },
    setPropNull(h, name) { at(h)[name] = null; },
    setInnerHTML(h, html) { at(h).innerHTML = html; },
    trapClick(h) { at(h).onclick = noop; },
    free(h) {
      const node = table[h];
      if (node != null) { delete node[HANDLE]; table[h] = null; }
    },
    beginCommit(root) { noted = noteSelection(at(root)); },
    endCommit(root) { if (noted !== null) restoreSelection(noted, at(root)); noted = null; },
    clearContainer(h) { clearContainer(at(h)); },
    listenRoot(h) { host.onListenRoot?.(at(h), h); },
    listen(h, index, type, flags) {
      const node = at(h), forwarder = new Forwarder(node, h, index, type, (flags & 1) !== 0);
      (node[LISTENERS] ??= [])[index] = forwarder;
      node.addEventListener(type, forwarder, (flags & 6) === 0 ? forwarder.capture : OPTIONS[flags & 7]);
    },
    cloneTemplate(id, w, start, count) {
      // The clone's nodes take the handles in document order: the root, then each node below it.
      const clone = templates[id].cloneNode(true);
      let node = clone, i = start;
      const end = start + count;
      while (i < end) {
        enter(w[i++], node);
        if (node.firstChild !== null) { node = node.firstChild; continue; }
        while (node !== clone && node.nextSibling === null) node = node.parentNode;
        if (node === clone) break;
        node = node.nextSibling;
      }
    },
    delegate(h, delegation, type) {
      at(h).addEventListener(type, (event) => {
        const above = host.handleAbove(event.target);
        dispatchDelegated(delegation, above < 0 ? -above : above, event);
      });
    },
    unlisten(h, index) {
      const node = at(h), own = node[LISTENERS], f = own?.[index];
      if (f == null) return;
      own[index] = null;
      node.removeEventListener(f.type, f, f.capture);
    },
  };

  streams.consume(DOM_CHANNEL, (channel) => {
    channel.replay = replayDom;
    channel.handlers = handlers;
  });

  const host = {
    streams,
    imports: {
      ...streams.imports,
      "host:dom": {
        adopt(node, h) {
          const known = node[HANDLE];
          if (known !== undefined && table[known] === node) return known;
          enter(h, node);
          return h;
        },
        node: (h) => at(h),
        handleAbove: (node) => host.handleAbove(node),
        events(dispatch) { dispatchEvent = dispatch; },
        delegated(dispatch) { dispatchDelegated = dispatch; },
        template(id, html) {
          const t = document.createElement("template");
          t.innerHTML = html;
          const content = t.content;
          const root = content.childNodes.length === 1 ? content.firstChild : content;
          templates[id] = root;
          // Its shape: per node in document order, six fields each ended by U+0001 (dom.ts DomTemplate).
          let shape = "";
          for (let node = root; node !== null;) {
            shape += `${node.nodeType}\u0001${node.childNodes.length}\u0001${node.nodeName}\u0001${node.localName ?? ""}\u0001${node.namespaceURI ?? ""}\u0001${node.nodeType === 1 || node.nodeType === 11 ? "" : node.data}\u0001`;
            if (node.firstChild !== null) { node = node.firstChild; continue; }
            while (node !== root && node.nextSibling === null) node = node.parentNode;
            node = node === root ? null : node.nextSibling;
          }
          return shape;
        },
        describe(node, what) {
          switch (what) {
            case 0: return String(node.nodeType);
            case 1: return node.nodeName;
            case 2: return node.namespaceURI ?? "";
            default: return node.localName ?? "";
          }
        },
      },
    },
    /** The nearest table node at or above `node`: its handle when it is `node`, minus its handle for an ancestor, 0 for none. */
    handleAbove(node) {
      const own = node?.[HANDLE];
      if (own !== undefined) return own;
      for (let n = node?.parentNode; n != null; n = n.parentNode) {
        const h = n[HANDLE];
        if (h !== undefined) return -h;
      }
      return 0;
    },
    nodeOf: (h) => table[h] ?? null,
    /** Set by an event layer: a root asked for its events (listenRoot). */
    onListenRoot: null,
    table,
  };
  return host;
}

// React DOM's clearContainer (ReactFiberConfigDOM.ts), on the page.
function clearContainer(container) {
  const nodeType = container.nodeType;
  if (nodeType === 9) clearChildrenSparingly(container);
  else if (nodeType === 1) {
    switch (container.nodeName) {
      case "HEAD": case "HTML": case "BODY": clearChildrenSparingly(container); return;
      default: container.textContent = "";
    }
  }
}
function clearChildrenSparingly(container) {
  let node, next = container.firstChild;
  if (next && next.nodeType === 10) next = next.nextSibling;
  while (next) {
    node = next;
    next = next.nextSibling;
    switch (node.nodeName) {
      case "HTML": case "HEAD": case "BODY": clearChildrenSparingly(node); continue;
      case "SCRIPT": case "STYLE": continue;
      case "LINK": if (node.rel.toLowerCase() === "stylesheet") continue;
    }
    container.removeChild(node);
  }
}

// React DOM's getSelectionInformation and restoreSelection (ReactInputSelection.ts), on the page.
function activeElementDeep(container) {
  let win = container?.ownerDocument?.defaultView ?? window;
  let element = activeElementOf(win.document);
  while (element instanceof win.HTMLIFrameElement) {
    let sameOrigin = false;
    try { sameOrigin = typeof element.contentWindow.location.href === "string"; } catch { sameOrigin = false; }
    if (!sameOrigin) return element;
    win = element.contentWindow;
    element = activeElementOf(win.document);
  }
  return element;
}
function activeElementOf(doc) {
  if (doc === undefined) return null;
  try { return doc.activeElement || doc.body; } catch { return doc.body; }
}
function hasSelectionCapabilities(elem) {
  const nodeName = elem && elem.nodeName && elem.nodeName.toLowerCase();
  return !!nodeName && ((nodeName === "input" && (elem.type === "text" || elem.type === "search" || elem.type === "tel" || elem.type === "url" || elem.type === "password")) ||
    nodeName === "textarea" || elem.contentEditable === "true");
}
function noteSelection(container) {
  const focusedElem = activeElementDeep(container);
  let selectionRange = null;
  if (hasSelectionCapabilities(focusedElem)) {
    if ("selectionStart" in focusedElem) selectionRange = { start: focusedElem.selectionStart, end: focusedElem.selectionEnd };
    else selectionRange = contentEditableOffsets(focusedElem);
  }
  return { focusedElem, selectionRange };
}
function contentEditableOffsets(outerNode) {
  // A contentEditable element's selection: React reads it through getOffsets (ReactDOMSelection.ts); kept as the DOM's own range here.
  const win = outerNode.ownerDocument?.defaultView ?? window;
  const selection = win.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  return { range: selection.getRangeAt(0).cloneRange() };
}
function restoreSelection(info, container) {
  const curFocusedElem = activeElementDeep(container);
  const priorFocusedElem = info.focusedElem;
  const priorSelectionRange = info.selectionRange;
  if (curFocusedElem !== priorFocusedElem && priorFocusedElem && priorFocusedElem.ownerDocument &&
      priorFocusedElem.ownerDocument.documentElement.contains(priorFocusedElem)) {
    if (priorSelectionRange !== null && hasSelectionCapabilities(priorFocusedElem)) {
      if ("selectionStart" in priorFocusedElem && "start" in priorSelectionRange) {
        priorFocusedElem.selectionStart = priorSelectionRange.start;
        priorFocusedElem.selectionEnd = Math.min(priorSelectionRange.end, priorFocusedElem.value.length);
      } else if (priorSelectionRange.range) {
        const win = priorFocusedElem.ownerDocument.defaultView ?? window;
        const selection = win.getSelection();
        selection.removeAllRanges();
        selection.addRange(priorSelectionRange.range);
      }
    }
    const ancestors = [];
    for (let a = priorFocusedElem; (a = a.parentNode);) {
      if (a.nodeType === 1) ancestors.push({ element: a, left: a.scrollLeft, top: a.scrollTop });
    }
    if (typeof priorFocusedElem.focus === "function") priorFocusedElem.focus();
    for (const { element, left, top } of ancestors) { element.scrollLeft = left; element.scrollTop = top; }
  }
}
