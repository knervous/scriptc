// The task-ring script the browser lane runs under threads=auto (a consumer Worker when the page is cross-origin
// isolated, the owner's thread otherwise): the logs must be identical (packages/compiler/test/task-ring.test.ts is
// the Node version).
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

async function settle(ring, log, until) {
  let reaped = 0;
  while (reaped < until) {
    const seen = ring.completed();
    reaped += ring.reap((id, status, result) => log.push(`done ${id} ${status} ${result}`));
    if (reaped < until) await ring.waitForCompletion(seen);
  }
}

export async function script(ring) {
  const log = [];
  const submit = (entry, fill, length, work) => {
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
  log.push(`bad ${ring.publish((ring.claim() + 1) % ring.slots, 1, 1, 1)}`);
  ring.hold(true);
  for (let i = 0; i < 3; i++) submit(1, 9, 10, 1);
  ring.stop();
  ring.hold(false);
  await settle(ring, log, 3);
  log.push(`after stop ${ring.claim()} ${ring.publish(0, 1, 1, 1)}`);
  return log;
}
