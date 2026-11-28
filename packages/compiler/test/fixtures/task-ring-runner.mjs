// The task runner both task-ring modes use (task-ring.test.ts), and the consumer thread of the shared mode. Plain
// JavaScript over the built compiler: a worker thread loads it without a TypeScript loader, on every Node.
import { isMainThread, parentPort, workerData } from "node:worker_threads";

/** entry 1: a checksum of the payload, repeated `work` times; 2: status 7; 3: throws; anything else: status -1. */
export const runner = (entry, payload, length, work) => {
  if (entry === 1) {
    let h = 0;
    for (let w = 0; w < work; w++) for (let i = 0; i < length; i++) h = (Math.imul(h, 31) + payload[i] + w) | 0;
    return { status: 0, result: h };
  }
  if (entry === 2) return { status: 7, result: length };
  if (entry === 3) throw new Error("runner failure");
  return { status: -1, result: 0 };
};

if (!isMainThread && workerData?.taskRing) {
  const { runTaskConsumer } = await import("../../dist/backend/wasmgc/task-ring.js");
  const { buffer, byteOffset, layout } = workerData;
  runTaskConsumer(buffer, byteOffset, layout, runner);
  parentPort?.postMessage("exited");
}
