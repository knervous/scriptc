/* A bounded single-producer/single-consumer task ring (docs/capabilities.md §4.3), with the threads mode chosen at
 * load: a consumer thread over shared memory, or the same protocol drained on the owner's thread.
 *
 * Layout, in 32-bit words from `byteOffset`:
 *   header (16 words): [0 head: tasks published, 1 tail: tasks taken, 2 completions, 3 stop, 4 consumer state
 *                       (0 idle, 1 running, 2 exited), 5 epoch, 6 hold, 7..15 reserved]
 *   slots (8 words each): [state, task id, entry, length, work, status, result, reserved]
 *   payloads: `slots` regions of `payloadBytes` bytes, 16-byte aligned.
 * Slot states: FREE -> READY (the producer filled and published it) -> TAKEN (the consumer claimed it) -> DONE (status
 * and result written) -> FREE (the producer reaped it). Task ids are the submission sequence; reaping checks them.
 *
 * Every publish and stop moves the epoch on; a consumer captures the epoch before checking for work, then waits for
 * a change from it, so no wakeup is lost. The owner does the same with the completion count.
 *
 * threads=shared: the consumer is another thread (a Worker running runTaskConsumer on the same SharedArrayBuffer),
 * which waits with Atomics.wait; the owner awaits completions with Atomics.waitAsync.
 * threads=off: the consumer is a task on the owner's thread. A publish queues one macrotask (MessageChannel) that
 * drains READY slots in submission order through the same state machine; completions resolve a promise.
 * The two differ in timing only: the same tasks give the same ids, statuses, results, refusals and order.
 *
 * No Node imports: pages and Workers load it as is. */

import { detectCapabilities } from "./capabilities.js";

const HEADER_WORDS = 16, SLOT_WORDS = 8;
const H_HEAD = 0, H_TAIL = 1, H_DONE = 2, H_STOP = 3, H_CONSUMER = 4, H_EPOCH = 5, H_HOLD = 6;
const S_FREE = 0, S_READY = 1, S_TAKEN = 2, S_DONE = 3;
/** Statuses the ring itself writes: a task cancelled by stop, a reap that found another generation, and a task whose
 * runner threw. Runners answer their own statuses (0 for success). */
export const STATUS_CANCELLED = -3, STATUS_STALE = -4, STATUS_FAILED = -5;
/** claim and publish refusals. */
export const RING_FULL = -1, RING_STOPPED = -2, RING_BAD_PUBLISH = -3;

export interface TaskRingLayout {
  /** Slots (tasks in flight). Default 8. */
  slots?: number;
  /** Bytes per payload region (a multiple of 16). Default 64 KiB. */
  payloadBytes?: number;
}

/** Runs one task: `payload` is the slot's region (the first `length` bytes are the task's), `entry` and `work` are
 * what the producer published. Answers the status (0 for success) and an integer result. */
export type TaskRunner = (entry: number, payload: Uint8Array, length: number, work: number) => { status: number; result: number };

/** Bytes a ring of `layout` needs. */
export function taskRingBytes(layout: TaskRingLayout = {}): number {
  const { slots, payloadBytes } = normalize(layout);
  return (HEADER_WORDS + slots * SLOT_WORDS) * 4 + slots * payloadBytes;
}

function normalize(layout: TaskRingLayout): { slots: number; payloadBytes: number } {
  const slots = layout.slots ?? 8, payloadBytes = layout.payloadBytes ?? 64 * 1024;
  if (!(Number.isInteger(slots) && slots > 0) || !(Number.isInteger(payloadBytes) && payloadBytes > 0 && payloadBytes % 16 === 0))
    throw new RangeError("task ring: slots must be a positive integer and payloadBytes a positive multiple of 16");
  return { slots, payloadBytes };
}

/** The shared view of a ring's memory: words, slot words, payload regions. */
class RingView {
  readonly words: Int32Array;
  readonly slots: number;
  readonly payloadBytes: number;
  private readonly bytes: Uint8Array;
  private readonly payloadBase: number;
  constructor(buffer: ArrayBufferLike, byteOffset: number, layout: TaskRingLayout) {
    const { slots, payloadBytes } = normalize(layout);
    if (byteOffset % 16 !== 0) throw new RangeError("task ring: byteOffset must be 16-byte aligned");
    this.slots = slots;
    this.payloadBytes = payloadBytes;
    this.words = new Int32Array(buffer, byteOffset, HEADER_WORDS + slots * SLOT_WORDS);
    this.payloadBase = byteOffset + (HEADER_WORDS + slots * SLOT_WORDS) * 4;
    this.bytes = new Uint8Array(buffer, this.payloadBase, slots * payloadBytes);
  }
  slotWord(slot: number, i: number): number { return HEADER_WORDS + slot * SLOT_WORDS + i; }
  payload(slot: number): Uint8Array { return this.bytes.subarray(slot * this.payloadBytes, (slot + 1) * this.payloadBytes); }
  load(i: number): number { return Atomics.load(this.words, i); }
  store(i: number, v: number): void { Atomics.store(this.words, i, v); }
}

/** One consumer step over a view: take and run every READY slot in order, or settle queued slots as cancelled once
 * stopped. Returns whether it completed anything. `notify` wakes the owner (a no-op on one thread). */
function drain(v: RingView, run: TaskRunner, notify: () => void): boolean {
  let progressed = false;
  for (;;) {
    if (v.load(H_HOLD) !== 0) return progressed;
    const tail = v.load(H_TAIL);
    if (tail >= v.load(H_HEAD)) return progressed;
    const slot = tail % v.slots;
    if (Atomics.compareExchange(v.words, v.slotWord(slot, 0), S_READY, S_TAKEN) !== S_READY) return progressed;
    v.store(H_TAIL, tail + 1);
    let status = STATUS_CANCELLED, result = 0;
    if (v.load(H_STOP) === 0) {
      const entry = v.words[v.slotWord(slot, 2)]!, length = v.words[v.slotWord(slot, 3)]!, work = v.words[v.slotWord(slot, 4)]!;
      try { ({ status, result } = run(entry, v.payload(slot), length, work)); status |= 0; result |= 0; }
      catch { status = STATUS_FAILED; result = 0; }
    }
    v.words[v.slotWord(slot, 5)] = status;
    v.words[v.slotWord(slot, 6)] = result;
    v.store(v.slotWord(slot, 0), S_DONE);
    Atomics.add(v.words, H_DONE, 1);
    progressed = true;
    notify();
  }
}

/** The consumer thread's loop (threads=shared): run it in a Worker over the ring's SharedArrayBuffer. It sleeps on the
 * epoch, runs READY tasks in order, settles queued tasks as cancelled after stop, and returns once stopped. */
export function runTaskConsumer(buffer: SharedArrayBuffer, byteOffset: number, layout: TaskRingLayout, run: TaskRunner): void {
  const v = new RingView(buffer, byteOffset, layout);
  v.store(H_CONSUMER, 1);
  const notify = () => { Atomics.add(v.words, H_EPOCH, 1); Atomics.notify(v.words, H_DONE); };
  for (;;) {
    const epoch = v.load(H_EPOCH);
    drain(v, run, notify);
    if (v.load(H_STOP) !== 0 && v.load(H_TAIL) >= v.load(H_HEAD)) break;
    Atomics.wait(v.words, H_EPOCH, epoch);
  }
  v.store(H_CONSUMER, 2);
  notify();
}

export interface TaskRingOptions extends TaskRingLayout {
  /** off: the consumer runs on this thread. shared: a consumer thread (needs `startConsumer` and shared memory).
   * auto (the default): shared when this engine and page can share memory (a page must be cross-origin isolated)
   * and `startConsumer` is given, else off. */
  threads?: "auto" | "off" | "shared";
  /** threads=off (and auto's fallback): the task runner. */
  run?: TaskRunner;
  /** threads=shared: start a consumer thread over the ring (it calls runTaskConsumer with these arguments). */
  startConsumer?: (buffer: SharedArrayBuffer, byteOffset: number, layout: Required<TaskRingLayout>) => void;
  /** The ring's memory (else a fresh one): a SharedArrayBuffer for shared, either kind for off. */
  buffer?: ArrayBufferLike;
  byteOffset?: number;
}

export interface TaskRing {
  /** "shared" or "off": the mode the ring resolved to. */
  readonly threads: "shared" | "off";
  readonly buffer: ArrayBufferLike;
  readonly byteOffset: number;
  readonly slots: number;
  readonly payloadBytes: number;
  /** The next slot to fill, RING_FULL (backpressure) or RING_STOPPED. */
  claim(): number;
  /** A slot's payload region. */
  payload(slot: number): Uint8Array;
  /** Hands a filled, claimed slot to the consumer: the task id, or RING_BAD_PUBLISH (not the claimed slot, a length
   * outside the region, or after stop). */
  publish(slot: number, entry: number, length: number, work: number): number;
  /** Reaps completed tasks in submission order, each settled before its callback runs: how many it reaped. */
  reap(done: (taskId: number, status: number, result: number) => void): number;
  /** Tasks completed so far (read before reaping, then wait from it: no lost wakeup). */
  completed(): number;
  /** Resolves once the completion count moves past `seen`. */
  waitForCompletion(seen: number): Promise<void>;
  /** No new tasks; the consumer finishes the task in hand, settles queued ones as STATUS_CANCELLED, and stops. */
  stop(): void;
  /** Holds the consumer between tasks while set (tests use it to make cancellation deterministic). */
  hold(on: boolean): void;
  /** 0 idle, 1 running, 2 exited. */
  consumerState(): number;
}

/** A task ring in the mode `options.threads` resolves to (see TaskRingOptions.threads). */
export function createTaskRing(options: TaskRingOptions = {}): TaskRing {
  const { slots, payloadBytes } = normalize(options);
  const caps = detectCapabilities();
  const canShare = caps["shared-memory"] && caps["cross-origin-isolation"] && typeof SharedArrayBuffer === "function";
  const want = options.threads ?? "auto";
  if (want === "shared" && (!canShare || !options.startConsumer))
    throw new Error(!canShare ? "task ring: threads=shared needs shared memory, which a page has only when cross-origin isolated (serve it with \"Cross-Origin-Opener-Policy: same-origin\" and \"Cross-Origin-Embedder-Policy: require-corp\")" : "task ring: threads=shared needs startConsumer");
  const threads: "shared" | "off" = want === "shared" || (want === "auto" && canShare && options.startConsumer !== undefined) ? "shared" : "off";
  if (threads === "off" && !options.run) throw new Error("task ring: threads=off (or auto without shared memory) needs run, the task runner");
  const bytes = taskRingBytes({ slots, payloadBytes });
  const byteOffset = options.byteOffset ?? 0;
  const buffer = options.buffer ?? (threads === "shared" ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));
  if (threads === "shared" && !(buffer instanceof SharedArrayBuffer)) throw new Error("task ring: threads=shared needs a SharedArrayBuffer");
  const v = new RingView(buffer, byteOffset, { slots, payloadBytes });
  // A ring over memory that already holds one continues it (every earlier task reaped).
  let submitted = v.load(H_HEAD), reaped = submitted, stopped = v.load(H_STOP) !== 0;
  const bumpEpoch = () => { Atomics.add(v.words, H_EPOCH, 1); if (threads === "shared") Atomics.notify(v.words, H_EPOCH); };

  // threads=off: completions wake waiters through promises, and publishes schedule one drain at a time.
  const waiters: (() => void)[] = [];
  const wakeWaiters = () => { for (const w of waiters.splice(0)) w(); };
  let scheduled = false;
  const channel = threads === "off" && typeof MessageChannel === "function" ? new MessageChannel() : null;
  const runDrain = () => {
    scheduled = false;
    v.store(H_CONSUMER, 1);
    drain(v, options.run!, wakeWaiters);
    if (v.load(H_STOP) !== 0 && v.load(H_TAIL) >= v.load(H_HEAD)) { v.store(H_CONSUMER, 2); wakeWaiters(); }
    else v.store(H_CONSUMER, 0);
  };
  if (channel) {
    // A page's MessagePort and Node's both take onmessage; Node's must not keep the process alive by itself.
    const port = channel.port1 as unknown as { onmessage: unknown; unref?: () => void };
    port.onmessage = runDrain;
    port.unref?.();
  }
  const schedule = () => {
    if (threads !== "off" || scheduled) return;
    scheduled = true;
    if (channel) channel.port2.postMessage(0); else setTimeout(runDrain, 0);
  };

  if (threads === "shared") options.startConsumer!(buffer as SharedArrayBuffer, byteOffset, { slots, payloadBytes });

  return {
    threads, buffer, byteOffset, slots, payloadBytes,
    claim() {
      if (stopped) return RING_STOPPED;
      const slot = submitted % slots;
      return v.load(v.slotWord(slot, 0)) === S_FREE ? slot : RING_FULL;
    },
    payload: (slot) => v.payload(slot),
    publish(slot, entry, length, work) {
      if (stopped || slot !== submitted % slots || v.load(v.slotWord(slot, 0)) !== S_FREE || !(length >= 0 && length <= payloadBytes)) return RING_BAD_PUBLISH;
      v.words[v.slotWord(slot, 1)] = submitted;
      v.words[v.slotWord(slot, 2)] = entry;
      v.words[v.slotWord(slot, 3)] = length;
      v.words[v.slotWord(slot, 4)] = work;
      v.store(v.slotWord(slot, 0), S_READY);
      submitted++;
      v.store(H_HEAD, submitted);
      bumpEpoch();
      schedule();
      return submitted - 1;
    },
    reap(done) {
      let n = 0;
      while (reaped < submitted) {
        const slot = reaped % slots;
        if (v.load(v.slotWord(slot, 0)) !== S_DONE) break;
        const id = v.words[v.slotWord(slot, 1)]!;
        const status = id === reaped ? v.words[v.slotWord(slot, 5)]! : STATUS_STALE, result = id === reaped ? v.words[v.slotWord(slot, 6)]! : 0;
        v.store(v.slotWord(slot, 0), S_FREE);
        const taskId = reaped++;
        n++;
        done(taskId, status, result);
      }
      return n;
    },
    completed: () => v.load(H_DONE),
    waitForCompletion(seen) {
      if (v.load(H_DONE) !== seen) return Promise.resolve();
      if (threads === "shared") {
        const r = (Atomics as unknown as { waitAsync?: (a: Int32Array, i: number, v: number) => { async: boolean; value: Promise<string> | string } }).waitAsync?.(v.words, H_DONE, seen);
        if (r) return r.async ? (r.value as Promise<string>).then(() => undefined) : Promise.resolve();
        // No waitAsync (a Worker owner can block, a page cannot): poll on a timer.
        return new Promise(resolve => { const tick = () => v.load(H_DONE) !== seen ? resolve() : setTimeout(tick, 1); tick(); });
      }
      return new Promise(resolve => { waiters.push(resolve); schedule(); });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      v.store(H_STOP, 1);
      bumpEpoch();
      schedule();
    },
    hold(on) {
      v.store(H_HOLD, on ? 1 : 0);
      bumpEpoch();
      if (!on) schedule();
    },
    consumerState: () => v.load(H_CONSUMER),
  };
}
