// @native-only: iterating the engine array Promise.all answers needs the native model (engine dyn has no iterNew)
async function load(text: string): Promise<Blob> {
  return new Response(text).blob();
}
async function main(): Promise<void> {
  const ps: Promise<Blob>[] = ["a", "bbb", "cc"].map((t) => load(t));
  const all = await Promise.all(ps);
  console.log(all.length);
  let total = 0;
  for (const b of all) total += b.size;
  console.log(total);
  const none: Promise<Blob>[] = [];
  console.log((await Promise.all(none)).length);
  const bad: Promise<Blob>[] = [load("x"), Promise.reject(new Error("boom"))];
  try { await Promise.all(bad); } catch (e) { console.log("rejected", (e as Error).message); }
}
main();
