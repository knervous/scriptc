// Solid's reactive core (solid-js 1.9.20, dist/solid.js) in TypeScript: the part this program reaches, with its nodes as
// typed classes. See ../PATCHES.md for what differs from the published file.
//
// Copyright (c) 2016-2025 Ryan Carniato. MIT License (LICENSE in this directory).

export type Accessor<T> = () => T;
/** A signal's setter. Solid's own also takes an updater function; this program passes values only. */
export type Setter<T> = (value: T) => T;

const STALE = 1;
const PENDING = 2;

/** Anything a computation can read: a signal, or a memo. */
export class SourceNode {
  observers: Computation[] | null = null;
  observerSlots: number[] | null = null;
}

/** A reactive scope: what it owns, and what runs when it is cleaned. */
export class Owner extends SourceNode {
  owned: Computation[] | null = null;
  cleanups: (() => void)[] | null = null;
  owner: Owner | null;
  constructor(owner: Owner | null) {
    super();
    this.owner = owner;
  }
}

export class Signal<T> extends SourceNode {
  value: T;
  constructor(value: T) {
    super();
    this.value = value;
  }
}

/** A computation: an effect (pure false), a memo (pure true, observed) or a pure computation. */
export class Computation extends Owner {
  fn: ((prev: unknown) => unknown) | null;
  state: number;
  /** ExecCount when it last ran; -1 for never (Solid's null). */
  updatedAt: number = -1;
  sources: SourceNode[] | null = null;
  sourceSlots: number[] | null = null;
  value: unknown;
  pure: boolean;
  /** A memo: it has observers and compares its values (Solid's "observers" in node). */
  memo: boolean = false;
  constructor(fn: ((prev: unknown) => unknown) | null, init: unknown, pure: boolean, state: number, owner: Owner | null) {
    super(owner);
    this.fn = fn;
    this.state = state;
    this.value = init;
    this.pure = pure;
  }
}

/** The root a component tree runs in when createRoot's function takes no disposer. */
const UNOWNED = new Owner(null);
let currentOwner: Owner | null = null;
let Listener: Computation | null = null;
let Updates: Computation[] | null = null;
let Effects: Computation[] | null = null;
let ExecCount = 0;

/** createRoot: every caller in this program takes the disposer, so the root is always owned (Solid makes an unowned root
 * for a function that declares no parameter). */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const listener = Listener, owner = currentOwner;
  const root = new Owner(owner);
  currentOwner = root;
  Listener = null;
  try {
    return runUpdates(() => fn(() => untrack(() => cleanNode(root, false))), true);
  } finally {
    Listener = listener;
    currentOwner = owner;
  }
}

export function createSignal<T>(value: T): [Accessor<T>, Setter<T>] {
  const s = new Signal<T>(value);
  const read = (): T => {
    track(s);
    return s.value;
  };
  const write = (next: T): T => {
    if (s.value !== next) {
      s.value = next;
      notify(s);
    }
    return next;
  };
  return [read, write];
}

/** An effect's values are its own business: they are unknown here (Solid's are generic). */
export function createRenderEffect(fn: (prev: unknown) => unknown, value?: unknown): void {
  updateComputation(createComputation(fn, value, false, STALE));
}

export function createMemo<T>(fn: (prev: T | undefined) => T, value?: T): Accessor<T> {
  const c = createComputation(fn as (prev: unknown) => unknown, value, true, 0);
  c.memo = true;
  updateComputation(c);
  return () => readMemo(c) as T;
}

export function createSelector<T>(source: Accessor<T>): (key: T) => boolean {
  const subs: Map<T, Set<Computation>> = new Map();
  const node = createComputation((p: unknown): unknown => {
    const v = source();
    for (const [key, val] of subs.entries()) {
      if ((key === v) !== (key === p)) {
        for (const c of val.values()) {
          c.state = STALE;
          if (c.pure) Updates!.push(c);
          else Effects!.push(c);
        }
      }
    }
    return v;
  }, undefined, true, STALE);
  updateComputation(node);
  return (key: T): boolean => {
    const listener = Listener;
    if (listener !== null) {
      let l = subs.get(key);
      if (l !== undefined) l.add(listener);
      else {
        l = new Set([listener]);
        subs.set(key, l);
      }
      const set = l;
      onCleanup(() => {
        set.delete(listener);
        if (set.size === 0) subs.delete(key);
      });
    }
    return key === (node.value as T);
  };
}

export function untrack<T>(fn: () => T): T {
  if (Listener === null) return fn();
  const listener = Listener;
  Listener = null;
  try {
    return fn();
  } finally {
    Listener = listener;
  }
}

export function onCleanup(fn: () => void): () => void {
  const o = currentOwner;
  if (o === null) return fn;
  if (o.cleanups === null) o.cleanups = [fn];
  else o.cleanups.push(fn);
  return fn;
}

function repairObserverSlots(source: SourceNode): void {
  source.observerSlots = source.observers!.map((observer, slot) => {
    const sources = observer.sources;
    if (sources === null) return -1;
    for (let i = sources.length - 1; i >= 0; i--) {
      if (sources[i] === source && observer.sourceSlots !== null && observer.sourceSlots[i] === slot) return i;
    }
    return sources.lastIndexOf(source);
  });
}

/** readSignal for a memo: brings it up to date first. */
function readMemo(c: Computation): unknown {
  if (c.state !== 0) {
    if (c.state === STALE) updateComputation(c);
    else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(c, null), false);
      Updates = updates;
    }
  }
  track(c);
  return c.value;
}

/** readSignal's tracking: the running computation observes `source`. */
function track(source: SourceNode): void {
  const listener = Listener;
  if (listener === null) return;
  const observers = source.observers;
  if (observers !== null && observers[observers.length - 1] === listener) return;
  const sSlot = observers !== null ? observers.length : 0;
  if (listener.sources === null) {
    listener.sources = [source];
    listener.sourceSlots = [sSlot];
  } else {
    listener.sources.push(source);
    listener.sourceSlots!.push(sSlot);
  }
  if (observers === null) {
    source.observers = [listener];
    source.observerSlots = [listener.sources.length - 1];
  } else {
    if (source.observerSlots === null || source.observerSlots.length !== observers.length) repairObserverSlots(source);
    observers.push(listener);
    source.observerSlots!.push(listener.sources.length - 1);
  }
}

/** writeSignal's notification, once the value changed. */
function notify(node: SourceNode): void {
  const observers = node.observers;
  if (observers === null || observers.length === 0) return;
  runUpdates(() => {
    for (let i = 0; i < observers.length; i += 1) {
      const o = observers[i]!;
      if (o.state === 0) {
        if (o.pure) Updates!.push(o);
        else Effects!.push(o);
        if (o.observers !== null) markDownstream(o);
      }
      o.state = STALE;
    }
    if (Updates!.length > 1e6) {
      Updates = [];
      throw new Error();
    }
  }, false);
}

function updateComputation(node: Computation): void {
  if (node.fn === null) return;
  cleanNode(node, true);
  runComputation(node, node.value, ExecCount);
}

function runComputation(node: Computation, value: unknown, time: number): void {
  let nextValue: unknown;
  const owner = currentOwner, listener = Listener;
  Listener = node;
  currentOwner = node;
  try {
    nextValue = node.fn!(value);
  } catch (err) {
    if (node.pure) {
      node.state = STALE;
      const owned = node.owned;
      if (owned !== null) for (const n of owned) cleanNode(n, false);
      node.owned = null;
    }
    node.updatedAt = time + 1;
    throw err;
  } finally {
    Listener = listener;
    currentOwner = owner;
  }
  if (node.updatedAt <= time) {
    if (node.updatedAt !== -1 && node.memo) {
      if (node.value !== nextValue) {
        node.value = nextValue;
        notify(node);
      }
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}

function createComputation(fn: (prev: unknown) => unknown, init: unknown, pure: boolean, state: number): Computation {
  const owner = currentOwner;
  const c = new Computation(fn, init, pure, state, owner);
  if (owner !== null && owner !== UNOWNED) {
    if (owner.owned === null) owner.owned = [c];
    else owner.owned.push(c);
  }
  return c;
}

function runTop(start: Computation): void {
  let node: Computation = start;
  if (node.state === 0) return;
  if (node.state === PENDING) return lookUpstream(node, null);
  const ancestors: Computation[] = [node];
  for (let o = node.owner; o instanceof Computation && (o.updatedAt === -1 || o.updatedAt < ExecCount); o = o.owner) {
    if (o.state !== 0) ancestors.push(o);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i]!;
    if (node.state === STALE) updateComputation(node);
    else if (node.state === PENDING) {
      const updates = Updates;
      Updates = null;
      const n = node;
      runUpdates(() => lookUpstream(n, ancestors[0]!), false);
      Updates = updates;
    }
  }
}

function runUpdates<T>(fn: () => T, init: boolean): T {
  if (Updates !== null) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects !== null) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait) Effects = null;
    Updates = null;
    throw err;
  }
}

function completeUpdates(wait: boolean): void {
  if (Updates !== null) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  const e = Effects!;
  Effects = null;
  if (e.length) runUpdates(() => runQueue(e), false);
  else afterUpdates();
}

function runQueue(queue: Computation[]): void {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]!);
}

/** Runs once an outermost update has run all its effects: the DOM layer's flush point (dom.ts). */
let afterUpdates: () => void = () => {};
export function setAfterUpdates(fn: () => void): void {
  afterUpdates = fn;
}

function lookUpstream(node: Computation, ignore: Computation | null): void {
  node.state = 0;
  const sources = node.sources!;
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]!;
    if (source instanceof Computation && source.sources !== null) {
      const state = source.state;
      if (state === STALE) {
        if (source !== ignore && (source.updatedAt === -1 || source.updatedAt < ExecCount)) runTop(source);
      } else if (state === PENDING) lookUpstream(source, ignore);
    }
  }
}

function markDownstream(node: SourceNode): void {
  const observers = node.observers!;
  for (let i = 0; i < observers.length; i += 1) {
    const o = observers[i]!;
    if (o.state === 0) {
      o.state = PENDING;
      if (o.pure) Updates!.push(o);
      else Effects!.push(o);
      if (o.observers !== null) markDownstream(o);
    }
  }
}

function cleanNode(node: Owner, recompute: boolean): void {
  let i: number;
  if (node instanceof Computation) {
    const sources = node.sources;
    if (sources !== null) {
      const sourceSlots = node.sourceSlots!;
      while (sources.length) {
        const source = sources.pop()!, index = sourceSlots.pop()!, obs = source.observers;
        if (obs !== null && obs.length) {
          if (source.observerSlots === null || source.observerSlots.length !== obs.length) repairObserverSlots(source);
          const n = obs.pop()!, s = source.observerSlots!.pop()!;
          if (index < obs.length) {
            n.sourceSlots![s] = index;
            obs[index] = n;
            source.observerSlots![index] = s;
          }
        }
      }
    }
  }
  const owned = node.owned;
  if (owned !== null) {
    for (i = owned.length - 1; i >= 0; i--) cleanNode(owned[i]!, false);
    node.owned = null;
  }
  const cleanups = node.cleanups;
  if (cleanups !== null) {
    for (i = cleanups.length - 1; i >= 0; i--) cleanups[i]!();
    node.cleanups = null;
  }
  if (node instanceof Computation) node.state = 0;
}

function dispose(d: (() => void)[]): void {
  for (let i = 0; i < d.length; i++) d[i]!();
}

export function mapArray<T, U>(list: Accessor<readonly T[] | null | undefined>, mapFn: (v: T) => U): () => U[] {
  let items: T[] = [], mapped: U[] = [], disposers: (() => void)[] = [], len = 0;
  onCleanup(() => dispose(disposers));
  return (): U[] => {
    const newItems: readonly T[] = list() ?? [], newLen = newItems.length;
    return untrack((): U[] => {
      let i: number, j: number;
      const mapper = (at: number): U => createRoot((disposer: () => void): U => {
        disposers[at] = disposer;
        return mapFn(newItems[at]!);
      });
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
        }
      } else if (len === 0) {
        mapped = new Array<U>(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j]!;
          mapped[j] = mapper(j);
        }
        len = newLen;
      } else {
        const temp = new Array<U>(newLen), tempdisposers = new Array<() => void>(newLen), has = new Array<boolean>(newLen).fill(false);
        let start: number, end: number, newEnd: number;
        for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++);
        for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
          temp[newEnd] = mapped[end]!;
          tempdisposers[newEnd] = disposers[end]!;
          has[newEnd] = true;
        }
        const newIndices: Map<T, number> = new Map();
        const newIndicesNext = new Array<number>(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          const item = newItems[j]!;
          const at = newIndices.get(item);
          newIndicesNext[j] = at === undefined ? -1 : at;
          newIndices.set(item, j);
        }
        for (i = start; i <= end; i++) {
          const item = items[i]!;
          const at = newIndices.get(item);
          if (at !== undefined && at !== -1) {
            temp[at] = mapped[i]!;
            tempdisposers[at] = disposers[i]!;
            has[at] = true;
            newIndices.set(item, newIndicesNext[at]!);
          } else disposers[i]!();
        }
        for (j = start; j < newLen; j++) {
          if (has[j]) {
            mapped[j] = temp[j]!;
            disposers[j] = tempdisposers[j]!;
          } else mapped[j] = mapper(j);
        }
        mapped = mapped.slice(0, len = newLen);
        items = newItems.slice(0);
      }
      return mapped;
    });
  };
}

export function createComponent<P>(Comp: (props: P) => unknown, props: P): unknown {
  return untrack(() => Comp(props));
}

/** For's props: `each` is the getter babel-preset-solid writes for a reactive expression. */
export function For<T>(props: { get each(): readonly T[]; readonly children: (item: T) => unknown }): unknown {
  return createMemo(mapArray(() => props.each, props.children));
}
