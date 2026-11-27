// @native-any-only: PromiseRejectedResult.reason is typed any; only the native-any lane represents it (engine dyn: jsval-to-dyn unsupported)
// @options: {"interfaceClassArms": true}
// Promise.allSettled over Array.from of promises; find the rejected result and
// read its reason.
const start = (i: number): Promise<{ id: number }> => (i === 2 ? Promise.reject(new Error("boom " + i)) : Promise.resolve({ id: i }));
async function main(): Promise<void> {
  const workers: { id: number }[] = [];
  const started = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) => start(i).then((w) => { workers.push(w); return w; })),
  );
  const failed = started.find((r): r is PromiseRejectedResult => r.status === "rejected");
  console.log(workers.map((w) => w.id).join(","), started.map((r) => r.status).join(","));
  try { throw failed ? failed.reason : new Error("none"); } catch (e) { console.log((e as Error).message); }
  const ok = started.filter((r): r is PromiseFulfilledResult<{ id: number }> => r.status === "fulfilled").map((r) => r.value.id);
  console.log(ok.join(","));
}
main();
