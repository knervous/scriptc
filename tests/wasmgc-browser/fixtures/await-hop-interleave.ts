// `await null` / `await <non-promise>` takes exactly one microtask turn: interleaving with other microtasks matches Node.
const log: string[] = [];
async function a(): Promise<void> {
  log.push("a0");
  await null;
  log.push("a1");
  await undefined;
  log.push("a2");
  const v = await 7;
  log.push("a3:" + v);
  const s = await "s";
  log.push("a4:" + s);
}
async function b(): Promise<number> {
  log.push("b0");
  await null;
  log.push("b1");
  await null;
  log.push("b2");
  return 1;
}
async function c(): Promise<number> {
  let n = 0;
  for (let i = 0; i < 3; i++) { n += (await i) + 1; log.push("c" + i); }
  for await (const x of [10, 20]) { log.push("cf" + x); n += x; }
  return n + (await null === null ? 100 : 0);
}
Promise.resolve().then(() => log.push("t1")).then(() => log.push("t2")).then(() => log.push("t3")).then(() => log.push("t4"));
const pa = a();
const pb = b();
const pc = c().then((n) => log.push("cres" + n));
queueMicrotask(() => log.push("q"));
log.push("sync");
async function main(): Promise<void> {
  await pa;
  await pb;
  await pc;
  console.log(log.join("\n"));
}
main();
