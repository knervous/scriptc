// try/finally across awaits in an async function: normal, return and throw completions all run the finally's awaits first.
const log: string[] = [];
async function normal(): Promise<number> {
  let n = 0;
  try { n += await Promise.resolve(5); } finally { await Promise.resolve(1); n++; log.push("fin-normal"); }
  return n;
}
async function early(): Promise<string> {
  try { await null; return "early"; } finally { await null; log.push("fin-early"); }
}
async function thrower(): Promise<void> {
  try { await null; throw new Error("boom"); } finally { await null; log.push("fin-throw"); }
}
async function main(): Promise<void> {
  console.log(await normal());
  console.log(await early());
  try { await thrower(); } catch (e) { console.log("caught", (e as Error).message); }
  console.log(log.join(","));
}
main();
