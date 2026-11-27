// await over a `Promise<string> | undefined` (a cached promise looked up in a Map, narrowed or not), and a .catch whose handler
// widens the payload to string | boolean: the fulfilled value passes through, the rejection runs the handler.
const cache = new Map<string, Promise<string>>();
async function resolveUrl(file: string, fail: boolean): Promise<string> {
  let pending = cache.get(file);
  if (!pending) {
    pending = (async () => { await Promise.resolve(); if (fail) throw new Error("no " + file); return "blob:" + file; })();
    pending.catch(() => cache.delete(file));
    cache.set(file, pending);
  }
  try {
    return await pending;
  } catch (error) {
    console.log("failed", (error as Error).message);
    return file;
  }
}
async function main(): Promise<void> {
  console.log(await resolveUrl("a", false), await resolveUrl("a", true), cache.size);
  console.log(await resolveUrl("b", true), cache.has("b"));
  const none = cache.get("none");
  const value = await none;
  console.log(value, typeof value);
  const some = cache.get("a");
  console.log(await some);
  const ok = Promise.resolve("fine");
  const bad = (async (): Promise<string> => { await Promise.resolve(); throw new Error("boom"); })();
  const r1: string | boolean = await ok.catch(() => false);
  const r2: string | boolean = await bad.catch(() => true);
  console.log(r1, typeof r1, r2, typeof r2);
}
main();
