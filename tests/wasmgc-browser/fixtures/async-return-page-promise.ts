// An async function returning a page promise adopts it (the return is an
// await): the caller sees the settled value, or the rejection.
async function text(): Promise<string> { return new Blob(["ab", "cd"]).text(); }
async function size(): Promise<number> {
  const buffer = await new Blob(["abc"]).arrayBuffer();
  return buffer.byteLength;
}
async function failing(): Promise<string> { return new Response(null, { status: 200 }).json(); }
async function main(): Promise<void> {
  console.log(await text(), await size());
  try { console.log(await failing()); } catch (e) { console.log("rejected", String(e).slice(0, 11)); }
}
void main();
