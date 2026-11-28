// Subscriptions of the LUI runtime: what a window listens to, described as data and diffed by key after every
// update. The key is the subscription's identity: a sync that lists a running key keeps the running one, closure and
// all, so a model-dependent parameter belongs in the key (a change restarts it), never only in the closure. A key
// listed twice in one sync is a bug: it warns, and the first one wins.

export interface Sub<Msg> {
  readonly key: string;
  /** Starts listening; returns the stop function. */
  readonly start: (send: (msg: Msg) => void) => () => void;
}

/** A message every `ms` milliseconds. */
export function every<Msg>(ms: number, toMsg: (now: number) => Msg): Sub<Msg> {
  return {
    key: `every:${ms}`,
    start: (send) => {
      const id = setInterval(() => send(toMsg(performance.now())), ms);
      return () => clearInterval(id);
    },
  };
}

/** A key pressed anywhere in the page (`code` as KeyboardEvent.key gives it, e.g. "Escape"). */
export function keyDown<Msg>(code: string, msg: Msg): Sub<Msg> {
  return {
    key: `key:${code}`,
    start: (send) => {
      const handler = (event: KeyboardEvent) => {
        if (event.key === code) send(msg);
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    },
  };
}

/** Who hears the runtime's warnings (a duplicate key, a cleanup that threw); null: nobody. */
let warningHandler: ((text: string) => void) | null = null;

/**
 * Where the runtime's warnings go. The runtime calls no console itself (not every host has one): a
 * page build may send them to console.warn; without a handler they are dropped.
 */
export function onRuntimeWarning(handler: ((text: string) => void) | null): void {
  warningHandler = handler;
}

/** A runtime warning, to whoever listens. */
export function runtimeWarning(text: string): void {
  if (warningHandler !== null) warningHandler(text);
}

/** A started subscription's stop function (held in a class: a compiled Map has no slot for bare function values yet). */
class Running {
  constructor(readonly stop: () => void) {}
}

/** Starts and stops a window's subscriptions as the list changes. */
export class SubRunner<Msg> {
  private readonly running = new Map<string, Running>();

  constructor(private readonly send: (msg: Msg) => void) {}

  /** The running subscriptions' keys (diagnostics). */
  keys(): string[] {
    return [...this.running.keys()];
  }

  sync(subs: readonly Sub<Msg>[]): void {
    const wanted = new Set<string>();
    for (const s of subs) {
      if (wanted.has(s.key)) {
        runtimeWarning(`[lui] subscription key "${s.key}" listed twice; the second is ignored`);
        continue;
      }
      wanted.add(s.key);
      if (!this.running.has(s.key)) this.running.set(s.key, new Running(s.start(this.send)));
    }
    for (const [key, running] of Array.from(this.running)) {
      if (wanted.has(key)) continue;
      this.running.delete(key);
      stopOne(key, running);
    }
  }

  /**
   * Stops every running subscription (a resting window: `setResting`). Each is forgotten before it stops, and one that
   * throws does not keep the rest running: a throw part-way would leave the stopped ones listed as running, so waking
   * never started them again.
   */
  stopAll(): void {
    const all = [...this.running];
    this.running.clear();
    for (const [key, running] of all) stopOne(key, running);
  }
}

/** A subscription's stop, its failure reported rather than thrown into the window's other subscriptions. */
function stopOne(key: string, running: Running): void {
  try {
    running.stop();
  } catch (error) {
    runtimeWarning(`[lui] subscription "${key}" threw as it stopped: ${String(error)}`);
  }
}
