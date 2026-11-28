// solid-js/web (dom-expressions 0.40 client runtime, solid-js 1.9.20 web/dist/web.js) in TypeScript: the part this
// program reaches. Its DOM goes through ./dom, which is either the page's own nodes (one host call per operation) or the DOM
// stream's compiled nodes; the build picks one. See ../PATCHES.md for what differs from the published file.
//
// Copyright (c) 2016-2025 Ryan Carniato. MIT License (LICENSE in this directory).
import {
  type HElement, type HNode, type MountableElement, type Template, adoptElement, appendChild, cloneTemplate, createText, delegate,
  firstChildOf, flushAfterUpdates, insertBefore, isText, makeTemplate, nextSiblingOf, parentOf, releaseElement, removeAttributeOf,
  removeNode, replaceChild, setAttributeOf, setClassName, setHandler, setText, setTextContent, textOf,
} from "solid-port-dom";
import { createRenderEffect, createRoot, setAfterUpdates } from "./solid-js";

export { createComponent, createMemo, createRenderEffect as effect, untrack } from "./solid-js";

setAfterUpdates(flushAfterUpdates);

function reconcileArrays(parentNode: HNode, a: HNode[], b: HNode[]): void {
  const bLength = b.length;
  let aEnd = a.length, bEnd = bLength, aStart = 0, bStart = 0, map: Map<HNode, number> | null = null;
  const after = nextSiblingOf(a[aEnd - 1]!);
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      const node = bEnd < bLength ? (bStart ? nextSiblingOf(b[bStart - 1]!) : b[bEnd - bStart]!) : after;
      while (bStart < bEnd) insertBefore(parentNode, b[bStart++]!, node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (map === null || !map.has(a[aStart]!)) removeNode(a[aStart]!);
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = nextSiblingOf(a[--aEnd]!);
      insertBefore(parentNode, b[bStart++]!, nextSiblingOf(a[aStart++]!));
      insertBefore(parentNode, b[--bEnd]!, node);
      a[aEnd] = b[bEnd]!;
    } else {
      if (map === null) {
        map = new Map();
        let i = bStart;
        while (i < bEnd) map.set(b[i]!, i++);
      }
      const index = map.get(a[aStart]!);
      if (index !== undefined) {
        if (bStart < index && index < bEnd) {
          let i = aStart, sequence = 1, t: number | undefined;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i]!)) === undefined || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart]!;
            while (bStart < index) insertBefore(parentNode, b[bStart++]!, node);
          } else replaceChild(parentNode, b[bStart++]!, a[aStart++]!);
        } else aStart++;
      } else removeNode(a[aStart++]!);
    }
  }
}

export type { MountableElement };

export function render(code: () => unknown, mountPoint: MountableElement): () => void {
  const element = adoptElement(mountPoint);
  let disposer: () => void = () => {};
  createRoot((dispose: () => void): number => {
    disposer = dispose;
    insert(element, code(), firstChildOf(element) !== null ? null : undefined);
    return 0;
  });
  return () => {
    disposer();
    setTextContent(element, "");
    flushAfterUpdates();
    releaseElement(element);
  };
}

/** A template: its HTML parsed once, then cloned per call. */
export function template(html: string): () => HElement {
  let t: Template | null = null;
  return (): HElement => {
    if (t === null) t = makeTemplate(html);
    return cloneTemplate(t);
  };
}

export function delegateEvents(eventNames: string[]): void {
  delegate(eventNames);
}

export function setAttribute(node: HNode, name: string, value: string | null | undefined): void {
  if (value == null) removeAttributeOf(node, name);
  else setAttributeOf(node, name, value);
}

export function className(node: HNode, value: string | null | undefined): void {
  if (value == null) removeAttributeOf(node, "class");
  else setClassName(node, value);
}

/** A handler for a delegated event goes on its node (Solid's `$$<name>` property); this program passes no data form. */
export function addEventListener(node: HNode, name: string, handler: (e: Event) => void, delegated: boolean): void {
  if (!delegated) throw new Error("solid port: only delegated events");
  setHandler(node, name, handler);
}

export function insert(parent: HNode, accessor: unknown, marker?: HNode | null, initial?: unknown): void {
  let init = initial;
  if (marker !== undefined && init === undefined) init = [];
  if (typeof accessor !== "function") {
    insertExpression(parent, accessor, init, marker, false);
    return;
  }
  const read = accessor as () => unknown;
  createRenderEffect((current: unknown): unknown => insertExpression(parent, read(), current, marker, false), init);
}

function insertExpression(parentIn: HNode, value: unknown, currentIn: unknown, marker: HNode | null | undefined, unwrapArray: boolean): unknown {
  let current = currentIn;
  let parent = parentIn;
  while (typeof current === "function") current = (current as () => unknown)();
  if (value === current) return current;
  const multi = marker !== undefined;
  if (multi && Array.isArray(current) && current.length > 0) {
    const p = parentOf(current[0] as HNode);
    if (p !== null) parent = p;
  }
  if (typeof value === "string" || typeof value === "number") {
    let text: string;
    if (typeof value === "number") {
      text = value.toString();
      if (text === current) return current;
    } else text = value;
    if (multi) {
      let node: HNode | null = Array.isArray(current) && current.length > 0 ? (current[0] as HNode) : null;
      if (node !== null && isText(node)) {
        if (textOf(node) !== text) setText(node, text);
      } else node = createText(text);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        setText(firstChildOf(parent)!, text);
        current = text;
      } else {
        setTextContent(parent, text);
        current = text;
      }
    }
  } else if (value == null || typeof value === "boolean") {
    current = cleanChildren(parent, current, marker, null);
  } else if (typeof value === "function") {
    const read = value as () => unknown;
    createRenderEffect((): unknown => {
      let v = read();
      while (typeof v === "function") v = (v as () => unknown)();
      current = insertExpression(parent, v, current, marker, false);
      return undefined;
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array: HNode[] = [];
    const currentArray = current != null && Array.isArray(current);
    if (normalizeIncomingArray(array, value as unknown[], current, unwrapArray)) {
      createRenderEffect((): unknown => {
        current = insertExpression(parent, array, current, marker, true);
        return undefined;
      });
      return () => current;
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker, null);
      if (multi) return current;
    } else if (currentArray) {
      const cur = current as HNode[];
      if (cur.length === 0) appendNodes(parent, array, marker ?? null);
      else reconcileArrays(parent, cur, array);
    } else {
      if (current != null && current !== "") cleanChildren(parent, [], undefined, null);
      appendNodes(parent, array, null);
    }
    current = array;
  } else {
    const node = value as HNode;
    if (Array.isArray(current)) {
      if (multi) return (current = cleanChildren(parent, current, marker, node));
      cleanChildren(parent, current, null, node);
    } else if (current == null || current === "" || firstChildOf(parent) === null) {
      appendChild(parent, node);
    } else replaceChild(parent, node, firstChildOf(parent)!);
    current = node;
  }
  return current;
}

function normalizeIncomingArray(normalized: HNode[], array: unknown[], current: unknown, unwrap: boolean): boolean {
  let dynamic = false;
  const cur = current != null && Array.isArray(current) ? (current as unknown[]) : null;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i];
    const prev = cur !== null ? cur[normalized.length] : undefined;
    if (item == null || item === true || item === false) {
      // nothing
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item as unknown[], prev, false) || dynamic;
    } else if (typeof item === "function") {
      if (unwrap) {
        while (typeof item === "function") item = (item as () => unknown)();
        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? (item as unknown[]) : [item],
          Array.isArray(prev) ? prev : [prev], false) || dynamic;
      } else {
        normalized.push(item as unknown as HNode);
        dynamic = true;
      }
    } else if (typeof item === "string" || typeof item === "number") {
      const value = String(item);
      if (prev != null && typeof prev === "object" && isText(prev as HNode) && textOf(prev as HNode) === value) normalized.push(prev as HNode);
      else normalized.push(createText(value));
    } else normalized.push(item as HNode);
  }
  return dynamic;
}

function appendNodes(parent: HNode, array: HNode[], marker: HNode | null): void {
  for (let i = 0, len = array.length; i < len; i++) insertBefore(parent, array[i]!, marker);
}

function cleanChildren(parent: HNode, currentIn: unknown, marker: HNode | null | undefined, replacement: HNode | null): unknown {
  if (marker === undefined) {
    setTextContent(parent, "");
    return "";
  }
  const current = currentIn as HNode[];
  const node = replacement ?? createText("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i]!;
      if (node !== el) {
        const isParent = parentOf(el) === parent;
        if (!inserted && !i) {
          if (isParent) replaceChild(parent, node, el);
          else insertBefore(parent, node, marker);
        } else if (isParent) removeNode(el);
      } else inserted = true;
    }
  } else insertBefore(parent, node, marker);
  return [node];
}

