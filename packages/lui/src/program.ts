// The LUI program loop: a Model, a typed Msg, a pure update, a view,
// commands and subscriptions. send(msg) runs update; the view and the patch run once, in a microtask, for every
// message sent in the same task (flush() runs them now; a handled DOM event flushes before it returns). Like React's
// batching, the DOM is current before the next paint, and a background tab (no animation frames) still updates.

import { appendChild, contains, mountPoint, parentOf, removeChild, type LElement } from '#dom';
import { adopt as adoptInto, afterCurrentCommit, commit, CommitStep, create, diagnostics, disposeTree, onAfterEvent, patch, release, type Attrs, type VElement } from './vdom';
import { runtimeWarning, type Sub, SubRunner } from './sub';

/**
 * What a command's scope needs from the program that runs it, as closures (a non-generic class: the compiled build
 * holds one class here, not every Program instantiation through an interface).
 */
export class ScopeOwner {
  constructor(readonly isDisposed: () => boolean, readonly queueAfterCommit: (step: CommitStep) => void) {}
}

/** What a command may hold onto past the update that asked for it. */
export class CmdScope {
  private readonly cleanups: Cleanup[] = [];
  private disposed = false;

  constructor(private readonly program: ScopeOwner) {}

  /** Runs `step` once the patch the current update asked for is in the DOM (afterCommit's half). */
  afterCommit(step: CommitStep): void {
    this.program.queueAfterCommit(step);
  }

  /** Whether the program is still running (an after-commit step checks this when it runs, not when it was queued). */
  get live(): boolean {
    return !this.disposed && !this.program.isDisposed();
  }

  /**
   * `stop` runs when the program is disposed: a timer, a request, a listener the command started. A command on a
   * program already disposed is stopped at once. The result lets the command forget the stop once its work is over
   * (a timer that fired), so a long-lived program does not collect them.
   */
  onDispose(stop: () => void): Cleanup {
    const cleanup = new Cleanup(stop);
    if (this.disposed || this.program.isDisposed()) {
      stop();
      return cleanup;
    }
    this.cleanups.push(cleanup);
    return cleanup;
  }

  /** Drops a stop registered with onDispose whose work is over. */
  forget(cleanup: Cleanup): void {
    const at = this.cleanups.indexOf(cleanup);
    if (at >= 0) this.cleanups.splice(at, 1);
  }

  /** How many stops are registered (tests). */
  get pending(): number {
    return this.cleanups.length;
  }

  /** Runs every registered stop, once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.cleanups.splice(0, this.cleanups.length)) {
      try {
        c.stop();
      } catch (error) {
        runtimeWarning(`[lui] a command cleanup threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

/** A registered stop (a class: a compiled array holds no bare function values). */
export class Cleanup {
  constructor(readonly stop: () => void) {}
}

/**
 * An effect a window asks for: run once, after its update, with the window's send. It runs before the view is
 * patched; a command that needs the DOM the update asked for is made with afterCommit. `scope.onDispose` ties a
 * timer, request or listener to the program's lifetime.
 */
export type Cmd<Msg> = (send: (msg: Msg) => void, scope: CmdScope) => void;

/** A command that runs once the patch its update asked for is in the DOM (focus, measuring, scrolling into view). */
export function afterCommit<Msg>(run: Cmd<Msg>): Cmd<Msg> {
  return (send, scope) => {
    // The program may be disposed between the queueing and the running (an onMount, or an earlier step, disposing it).
    scope.afterCommit(new CommitStep(() => {
      if (scope.live) run(send, scope);
    }));
  };
}

/**
 * `msg` after `ms` milliseconds, unless the program is disposed first (a notice expiring, an armed button disarming).
 * Write the model's own serial or token into `msg` when a newer one should supersede it. Name the window's message
 * type (`delay<Msg>(…)`): inferred from the literal, it would be that one arm's shape, which the compiled build treats
 * as a different record type.
 */
export function delay<Msg>(ms: number, msg: Msg): Cmd<Msg> {
  return (send, scope) => {
    let cleanup: Cleanup | null = null;
    const id = window.setTimeout(() => {
      if (cleanup !== null) scope.forget(cleanup);
      send(msg);
    }, ms);
    cleanup = scope.onDispose(() => window.clearTimeout(id));
  };
}

/** What update returns: the next model, and the effects to run after it. */
export interface Next<Model, Msg> {
  readonly model: Model;
  readonly cmds: readonly Cmd<Msg>[];
}

/** The next model with no effects. */
export function only<Model, Msg>(model: Model): Next<Model, Msg> {
  return { model, cmds: [] };
}

/** The next model and its effects. */
export function withCmds<Model, Msg>(model: Model, cmds: readonly Cmd<Msg>[]): Next<Model, Msg> {
  return { model, cmds };
}

export interface ProgramSpec<Model, Msg> {
  readonly init: Next<Model, Msg>;
  readonly update: (msg: Msg, model: Model) => Next<Model, Msg>;
  readonly view: (model: Model, send: (msg: Msg) => void) => VElement;
  /** The subscriptions the model wants; diffed by key after every update. */
  readonly subscriptions?: (model: Model) => readonly Sub<Msg>[];
  /** What diagnostics call the program (livePrograms, view errors). */
  readonly name?: string;
}

/** A live program, as diagnostics see it. */
export interface ProgramInfo {
  readonly name: string;
  readonly renders: number;
  readonly messages: number;
  readonly subscriptions: readonly string[];
  /** The latest messages, newest last (kept only while diagnostics are on). */
  readonly recent: readonly unknown[];
}

/** How many recent messages a program keeps while diagnostics are on. */
const RECENT = 12;

/** How the pending view and patch are scheduled: a microtask by default, replaceable for tests and benchmarks. */
export type Scheduler = (run: () => void) => void;

/** A program's entry in the dirty queue (a non-generic class: a compiled Set holds one class, by identity). */
class FlushEntry {
  constructor(readonly flush: () => void) {}
}

/** The programs with a pending patch: a handled DOM event flushes these, not every live program. */
const dirty = new Set<FlushEntry>();

/**
 * Flushes every dirty program. A flush can make another program dirty (an embedded program starting); a Set's
 * iteration visits entries added during it, so this drains until none is.
 */
function drainDirty(): void {
  drainQueued = false;
  for (const entry of dirty) {
    dirty.delete(entry);
    entry.flush();
  }
}

// The default schedule: one microtask per batch, for every dirty program, through this one module-level function. A
// host that keeps every function value handed to it for the session (one that cannot see a closure become
// unreachable) would otherwise grow without bound with a closure per program or per update, and pin every disposed
// program's tree.
let drainQueued = false;
function queueDrain(): void {
  if (drainQueued) return;
  drainQueued = true;
  queueMicrotask(drainDirty);
}

onAfterEvent(drainDirty);

/** An after-commit step queued while nothing was pending, with its program's liveness. */
class AfterStep {
  constructor(readonly owner: ScopeOwner, readonly step: CommitStep) {}
}

/** Steps for after the current task's commits, run by one module-level function (as the dirty queue is). */
const afterSteps: AfterStep[] = [];
function runAfterSteps(): void {
  const steps = afterSteps.splice(0, afterSteps.length);
  for (const s of steps) if (!s.owner.isDisposed()) afterCurrentCommit(s.step);
}

/** A live program's re-render, description and rest (a class: a compiled Set holds no bare function values). */
class Refresher {
  constructor(readonly run: () => void, readonly info: () => ProgramInfo, readonly rest: (on: boolean) => void) {}
}

const refreshers = new Set<Refresher>();

/**
 * Resting: while it holds, every program drawn inside the resting element (a part of the page hidden for a while) has
 * its subscriptions stopped -- its timers and listeners off, nothing to draw for -- and on waking they start again
 * from its current model. Updates still run; only the subscriptions wait. Loops of a page's own inside that element
 * listen with `onRest`.
 */
let resting = false;
let restingWithin: LElement | null = null;

/** A rest listener (a class: a compiled Set holds no bare function values). */
class RestListener {
  constructor(readonly call: (on: boolean) => void) {}
}

const restListeners = new Set<RestListener>();

/**
 * Embedded mounts made while resting (a hidden part of the page built behind a loading screen), started one a task
 * rather than all in the view that made their hosts: nothing shows them yet, and the page's thread stays free between
 * them. Waking starts any still waiting, before it draws.
 */
class DeferredStart {
  constructor(readonly run: () => void) {}
}

const deferredStarts: DeferredStart[] = [];
let deferredDraining = false;

function deferStart(run: () => void): void {
  deferredStarts.push(new DeferredStart(run));
  drainDeferredStarts();
}

function drainDeferredStarts(): void {
  if (deferredDraining || deferredStarts.length === 0) return;
  deferredDraining = true;
  setTimeout(() => {
    deferredDraining = false;
    deferredStarts.shift()?.run();
    drainDeferredStarts();
  }, 0);
}

function startDeferredNow(): void {
  while (deferredStarts.length > 0) deferredStarts.shift()!.run();
}

/** Rests (`on`) the programs drawn inside `within`, or wakes them. */
export function setResting(on: boolean, within: LElement | null = null): void {
  if (resting === on) return;
  resting = on;
  if (!on) startDeferredNow();
  // While resting, the element; on waking it stays until the programs that rested have woken.
  if (on) restingWithin = within;
  for (const r of refreshers) r.rest(on);
  if (!on) restingWithin = null;
  for (const listener of Array.from(restListeners)) listener.call(on);
}

export function isResting(): boolean {
  return resting;
}

/** Calls `listener` as resting starts and ends; answers the unsubscribe. */
export function onRest(listener: (on: boolean) => void): () => void {
  const entry = new RestListener(listener);
  restListeners.add(entry);
  return () => { restListeners.delete(entry); };
}

/**
 * Re-renders every live program from its current model: for state a view reads from outside its model that changed
 * (an image that failed to load and falls back to another). Rare by design.
 */
export function refreshAll(): void {
  for (const r of refreshers) r.run();
}

/** Every live program: name, renders, messages handled, running subscriptions, recent messages (diagnostics). */
export function livePrograms(): ProgramInfo[] {
  return [...refreshers].map((r) => r.info());
}

/** Turns diagnostics on or off (recent messages, element sources); see vdom `diagnostics`. */
export function setDiagnostics(on: boolean): void {
  diagnostics.enabled = on;
}

export class Program<Model, Msg> {
  private model: Model;
  private tree: VElement;
  private dirtyFlag = false;
  private disposed = false;
  private readonly subs: SubRunner<Msg>;
  /** True while this program rests (`setResting`): its subscriptions stopped. */
  private rested = false;
  private readonly refresher: Refresher;
  private readonly owner: ScopeOwner;
  private readonly scope: CmdScope;
  private readonly flushEntry: FlushEntry;
  /** After-commit steps waiting for this program's next patch. */
  private readonly waiting: CommitStep[] = [];
  private renders = 1;
  private messages = 0;
  private readonly recent: Msg[] = [];
  readonly send: (msg: Msg) => void;

  /**
   * `adopt`: the view's root vnode stands for `root` itself, so the program draws straight into an element another
   * view made, with no box of its own: contents() for children only, or an element of `root`'s tag to own its
   * attributes too (the parent then gives it none but its hooks). Disposing gives the root back as it found it: its
   * children, and the attributes and listeners the program put on it, leave. Else the view's element is appended.
   */
  constructor(
    private readonly spec: ProgramSpec<Model, Msg>,
    private readonly root: LElement,
    /** A replacement schedule (tests, benchmarks); the default is the shared microtask drain. */
    private readonly schedule: Scheduler | null = null,
    private readonly adopt = false,
    /** The name diagnostics use when the spec has none (an Embedded's). */
    private readonly fallbackName: string | null = null,
  ) {
    this.send = (msg: Msg) => this.receive(msg);
    this.subs = new SubRunner<Msg>(this.send);
    this.owner = new ScopeOwner(() => this.disposed, (step) => this.queueAfterCommit(step));
    this.scope = new CmdScope(this.owner);
    this.flushEntry = new FlushEntry(() => this.flush());
    this.model = spec.init.model;
    this.tree = spec.view(this.model, this.send);
    commit(() => {
      if (adopt) {
        adoptInto(root, this.tree);
      } else {
        appendChild(root, create(this.tree, root));
      }
    });
    this.refresher = new Refresher(() => this.refresh(), () => ({
      name: this.name, renders: this.renders, messages: this.messages, subscriptions: this.subs.keys(), recent: [...this.recent],
    }), (on) => this.rest(on));
    refreshers.add(this.refresher);
    this.rested = resting && this.restsHere();
    this.run(() => this.afterUpdate(spec.init.cmds));
  }

  /** The current model (tests, benchmarks, adapters). A snapshot, not a subscription. */
  get state(): Model {
    return this.model;
  }

  /** The program's name for diagnostics. */
  get name(): string {
    return this.spec.name ?? this.fallbackName ?? 'program';
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * A message sent while another is being handled (by a subscription as it starts, or a command as it runs) waits its
   * turn: handled in order once the current one is done. Handling it at once re-entered the subscription sync before
   * the starting subscription was registered, so it started again, without end.
   */
  private readonly queue: Msg[] = [];
  private receiving = false;

  private receive(msg: Msg): void {
    if (this.disposed) return;
    if (this.receiving) {
      this.queue.push(msg);
      return;
    }
    this.run(() => this.handle(msg));
  }

  /** Runs `first`, then every message sent meanwhile, in order. */
  private run(first: () => void): void {
    this.receiving = true;
    try {
      first();
      for (let i = 0; i < this.queue.length && !this.disposed; i++) this.handle(this.queue[i]);
    } finally {
      this.queue.length = 0;
      this.receiving = false;
    }
  }

  private handle(msg: Msg): void {
    this.messages++;
    if (diagnostics.enabled) {
      this.recent.push(msg);
      if (this.recent.length > RECENT) this.recent.shift();
    }
    const next = this.spec.update(msg, this.model);
    if (next.model !== this.model) {
      this.model = next.model;
      this.markDirty();
    }
    this.afterUpdate(next.cmds);
  }

  private markDirty(): void {
    if (this.dirtyFlag) return;
    this.dirtyFlag = true;
    dirty.add(this.flushEntry);
    if (this.schedule === null) queueDrain();
    else this.schedule(this.flushEntry.flush);
  }

  /** Whether this program draws inside the resting element. */
  private restsHere(): boolean {
    return restingWithin !== null && contains(restingWithin, this.root);
  }

  /**
   * Inside `run`, like an update: a subscription that sends as it starts or stops (most do) queues its message behind
   * the sync, rather than re-entering it before the starting subscription is registered (which started it twice).
   */
  private rest(on: boolean): void {
    if (this.disposed) return;
    if (on) {
      if (!this.restsHere()) return;
      this.rested = true;
      this.run(() => this.subs.stopAll());
    } else if (this.rested) {
      this.rested = false;
      const subscriptions = this.spec.subscriptions;
      if (subscriptions !== undefined) this.run(() => this.subs.sync(subscriptions(this.model)));
    }
  }

  private afterUpdate(cmds: readonly Cmd<Msg>[]): void {
    if (this.spec.subscriptions !== undefined && !this.rested) this.subs.sync(this.spec.subscriptions(this.model));
    for (const cmd of cmds) cmd(this.send, this.scope);
  }

  /** An after-commit step: after the pending patch, or (nothing pending) once the current task's commits are done. */
  queueAfterCommit(step: CommitStep): void {
    if (this.disposed) return;
    if (this.dirtyFlag) {
      this.waiting.push(step);
      return;
    }
    if (afterSteps.length === 0) queueMicrotask(runAfterSteps);
    afterSteps.push(new AfterStep(this.owner, step));
  }

  /** Schedules a view and patch from the current model. */
  refresh(): void {
    if (this.disposed) return;
    this.markDirty();
  }

  /** Runs the pending view and patch now. */
  flush(): void {
    if (!this.dirtyFlag || this.disposed) return;
    this.dirtyFlag = false;
    dirty.delete(this.flushEntry);
    const steps = this.waiting.splice(0, this.waiting.length);
    commit(() => {
      let patched = false;
      try {
        const next = this.spec.view(this.model, this.send);
        patch(this.tree, next);
        this.tree = next;
        this.renders++;
        patched = true;
      } catch (error) {
        if (viewErrorHandler === null) throw error;
        viewErrorHandler(error, this.name);
      }
      // A failed view patched nothing: the steps waiting for that patch are dropped, not run against the old DOM.
      if (patched) for (const step of steps) afterCurrentCommit(step);
    });
  }

  /** Stops subscriptions and command scopes and removes the program's DOM. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    dirty.delete(this.flushEntry);
    this.waiting.length = 0;
    refreshers.delete(this.refresher);
    this.subs.sync([]);
    this.scope.dispose();
    // A commit like any other change to the DOM, so it ends the way every commit does (`#dom`'s committed).
    commit(() => {
      if (this.adopt) {
        for (const c of this.tree.children) {
          const node = c.dom;
          if (node !== null && parentOf(node) === this.root) removeChild(this.root, node);
          disposeTree(c);
        }
        release(this.root, this.tree);
        return;
      }
      const node = this.tree.dom;
      if (node !== null && parentOf(node) === this.root) removeChild(this.root, node);
      disposeTree(this.tree);
    });
  }
}

/**
 * A program a view hosts in one of its own elements (a panel inside an outer program's layout): it starts when the element
 * is created, draws into it (adopting it: write the view with contents()), and stops when the element leaves. The
 * host element must have no children of its own in the parent's view.
 *
 * Each host element (and each attach) is its own mount with its own program: replacing a host (a changed key) starts
 * the new mount before the old one leaves, and the old one's removal stops only the old one. `send` reaches the
 * newest live mount.
 */
export class Embedded<Model, Msg> {
  private readonly mounts = new Map<LElement, Program<Model, Msg>>();
  private current: Program<Model, Msg> | null = null;
  /** Mounts made while resting, not started yet (`deferStart`): the props to start with and what was sent meanwhile. */
  private readonly pending = new Map<LElement, WaitingMount<Msg>>();

  /**
   * `makeSpec` runs at each mount (host or attach), as React runs a component's state initializers when it mounts: a
   * window hosted later than it was made (a pane opened, a frame that appears with its target) starts from the world as
   * it is then, not as it was when its host's view was first drawn.
   */
  constructor(private readonly makeSpec: () => ProgramSpec<Model, Msg>, private readonly name: string | null = null) {}

  /** The host element's hooks; `props`, when given, is sent as the program starts and on every patch of the host. */
  host(props: Msg | null = null): Attrs {
    return {
      ref: (element) => {
        if (!resting) {
          this.start(element, props);
          return;
        }
        this.pending.set(element, new WaitingMount<Msg>(props));
        deferStart(() => this.startPending(element));
      },
      onPatch: (element) => {
        if (props === null) return;
        const waiting = this.pending.get(element);
        if (waiting !== undefined) waiting.props = props;
        else this.mounts.get(element)?.send(props);
      },
      onRemove: (element) => {
        this.pending.delete(element);
        this.stop(element);
      },
    };
  }

  /** The newest live mount's model as it stands (a snapshot, not a subscription); null while none is started. */
  get state(): Model | null {
    return this.current === null ? null : this.current.state;
  }

  send(msg: Msg): void {
    if (this.current !== null) {
      this.current.send(msg);
      return;
    }
    // None started yet: the newest waiting mount takes it as it starts.
    let newest: WaitingMount<Msg> | null = null;
    for (const waiting of this.pending.values()) newest = waiting;
    newest?.messages.push(msg);
  }

  private startPending(element: LElement): void {
    const waiting = this.pending.get(element);
    if (waiting === undefined) return;
    this.pending.delete(element);
    const app = this.start(element, waiting.props);
    for (const msg of waiting.messages) app.send(msg);
  }

  /**
   * Starts the program in an element made outside any view (a test's or a tool's stage); the result stops that mount and
   * only that one, even after a later attach to the same element replaced it.
   */
  attach(element: LElement, props: Msg | null = null): Mounted {
    const app = this.start(element, props);
    return { dispose: () => {
      if (this.mounts.get(element) === app) this.stop(element);
      else app.dispose();
    } };
  }

  private start(element: LElement, props: Msg | null): Program<Model, Msg> {
    this.stop(element);
    const app = new Program<Model, Msg>(this.makeSpec(), element, null, true, this.name);
    this.mounts.set(element, app);
    this.current = app;
    if (props !== null) app.send(props);
    return app;
  }

  private stop(element: LElement): void {
    const app = this.mounts.get(element);
    if (app === undefined) return;
    this.mounts.delete(element);
    app.dispose();
    if (this.current !== app) return;
    this.current = null;
    for (const live of this.mounts.values()) this.current = live;
  }
}

/** An Embedded mount waiting to start (`Embedded.pending`). */
class WaitingMount<Msg> {
  readonly messages: Msg[] = [];
  constructor(public props: Msg | null) {}
}

/** Who hears an error thrown while a view draws (React's error boundary); null rethrows it. */
let viewErrorHandler: ((error: unknown, program: string) => void) | null = null;

/**
 * The app's error boundary: errors thrown while drawing go to `handler`, with the name of the program whose view threw,
 * instead of the page. The runtime itself logs nothing (not every host has a console).
 */
export function onViewError(handler: (error: unknown, program: string) => void): void {
  viewErrorHandler = handler;
}

/** A started program, as whatever started it sees it. */
export interface Mounted {
  dispose(): void;
}

/** Mounts a program into `root`. */
export function program<Model, Msg>(spec: ProgramSpec<Model, Msg>, root: Element, schedule?: Scheduler): Program<Model, Msg> {
  return new Program<Model, Msg>(spec, mountPoint(root), schedule);
}
