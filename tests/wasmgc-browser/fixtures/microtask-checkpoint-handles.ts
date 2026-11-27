// @options: {"hostHandles": true}
// A native host runs `drain` once per task however many microtasks the task queued: the drain is a whole checkpoint (jobs queued by jobs included), in FIFO order.
const out: string[] = [];
function later(f: () => void): void { Promise.resolve().then(f); }
later(() => { out.push("a"); later(() => { out.push("a2"); later(() => out.push("a3")); }); });
later(() => { out.push("b"); later(() => out.push("b2")); });
queueMicrotask(() => out.push("q"));
later(() => out.push("c"));
setTimeout(() => {
  out.push("timer");
  later(() => out.push("t1"));
  later(() => out.push("t2"));
  setTimeout(() => { console.log(out.join(",")); }, 0);
}, 0);
