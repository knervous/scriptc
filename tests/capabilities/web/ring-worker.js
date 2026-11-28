// The task ring's consumer thread in a page (threads=shared): runs the protocol over the ring's SharedArrayBuffer.
import { runTaskConsumer } from "/dist/backend/wasmgc/task-ring.js";
import { runner } from "./ring-script.js";
self.onmessage = ({ data: { buffer, byteOffset, layout } }) => {
  runTaskConsumer(buffer, byteOffset, layout, runner);
  self.postMessage("exited");
};
