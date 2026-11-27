// A page ArrayBuffer (a fetch body, a WebGPU mapped range) under a compiled
// typed array: a fresh one (slice/transfer) is the only referent, so the view
// is copied into compiled storage exactly.
async function main(): Promise<void> {
  const buf = await new Blob(["abcd"]).arrayBuffer();
  const bytes = new Uint8Array(buf.slice(0));
  console.log(bytes.length, Array.from(bytes).join(","));
  const words = new Uint16Array(buf.slice(0, 4));
  console.log(words.length, words[0], words[1]);
  bytes[0] = 0;
  console.log(new Uint8Array(buf.slice(0, 1))[0]);
}
void main();
