// The task ring's two threads modes (docs/capabilities.md §4.3): a consumer thread over shared memory, and the same
// protocol drained on the owner's thread. Run against the same script, they give the same ids, statuses, results,
// refusals and order; only timing differs.
import { Worker } from "node:worker_threads";
import { expect, test } from "vitest";
import { createTaskRing, RING_BAD_PUBLISH, RING_FULL, RING_STOPPED, STATUS_CANCELLED, STATUS_FAILED, type TaskRing } from "../src/backend/wasmgc/task-ring.js";
// A plain JavaScript fixture (the worker thread loads it too).
import { runner } from "./fixtures/task-ring-runner.mjs";

/** The consumer thread: the fixture over the built compiler (packages/compiler/dist; `pnpm -r build` first). */
const RUNNER = new URL("./fixtures/task-ring-runner.mjs", import.meta.url);

async function settle(ring: TaskRing, log: string[], until: number): Promise<void> {
  let reaped = 0;
  while (reaped < until) {
    const seen = ring.completed();
    reaped += ring.reap((id, status, result) => log.push(`done ${id} ${status} ${result}`));
    if (reaped < until) await ring.waitForCompletion(seen);
  }
}

/** The script: fill the ring (and be refused one more), a bad entry, a failing runner, reuse of every slot, then a
 * stop with tasks queued behind a hold, and publishes after stop. */
async function script(ring: TaskRing): Promise<string[]> {
  const log: string[] = [];
  const submit = (entry: number, fill: number, length: number, work: number) => {
    const slot = ring.claim();
    if (slot < 0) { log.push(`claim ${slot}`); return; }
    ring.payload(slot).fill(fill, 0, length);
    log.push(`publish ${ring.publish(slot, entry, length, work)}`);
  };
  for (let i = 0; i < ring.slots; i++) submit(i === 3 ? 9 : i === 1 ? 3 : i === 2 ? 2 : 1, i + 1, 64 + i, 1 + (i % 3));
  submit(1, 0, 1, 1);
  await settle(ring, log, ring.slots);
  for (let i = 0; i < ring.slots; i++) submit(1, 200 - i, 1000, 4);
  await settle(ring, log, ring.slots);
  // A bad publish: not the claimed slot.
  log.push(`bad ${ring.publish((ring.claim() + 1) % ring.slots, 1, 1, 1)}`);
  ring.hold(true);
  for (let i = 0; i < 3; i++) submit(1, 9, 10, 1);
  ring.stop();
  ring.hold(false);
  await settle(ring, log, 3);
  log.push(`after stop ${ring.claim()} ${ring.publish(0, 1, 1, 1)}`);
  return log;
}

test("threads=off: the protocol drained on this thread", async () => {
  const ring = createTaskRing({ threads: "off", run: runner, slots: 4, payloadBytes: 1024 });
  expect(ring.threads).toBe("off");
  const log = await script(ring);
  expect(log).toContain(`claim ${RING_FULL}`);
  expect(log).toContain(`done 3 -1 0`);
  expect(log).toContain(`done 1 ${STATUS_FAILED} 0`);
  expect(log).toContain(`done 2 7 66`);
  expect(log.filter(l => l.endsWith(`${STATUS_CANCELLED} 0`))).toHaveLength(3);
  expect(log.at(-1)).toBe(`after stop ${RING_STOPPED} ${RING_BAD_PUBLISH}`);
  expect(ring.consumerState()).toBe(2);
});

test("threads=shared and threads=off give the same log", async () => {
  const off = await script(createTaskRing({ threads: "off", run: runner, slots: 4, payloadBytes: 1024 }));
  let worker: Worker | undefined, exited!: Promise<unknown>;
  const ring = createTaskRing({
    threads: "shared", slots: 4, payloadBytes: 1024,
    startConsumer: (buffer, byteOffset, layout) => {
      worker = new Worker(RUNNER, { workerData: { taskRing: true, buffer, byteOffset, layout } });
      exited = new Promise((resolve) => worker!.on("message", (m) => { if (m === "exited") resolve(m); }));
    },
  });
  expect(ring.threads).toBe("shared");
  try {
    expect(await script(ring)).toEqual(off);
    await exited;
    expect(ring.consumerState()).toBe(2);
  } finally { await worker?.terminate(); }
});

test("threads=auto without a consumer thread falls back to this thread", () => {
  expect(createTaskRing({ run: runner }).threads).toBe("off");
  expect(() => createTaskRing({ threads: "shared", run: runner })).toThrow(/startConsumer/);
  expect(() => createTaskRing({ threads: "off" })).toThrow(/needs run/);
});
