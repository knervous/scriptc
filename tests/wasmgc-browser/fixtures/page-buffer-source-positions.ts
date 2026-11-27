// Compiled typed arrays at WebIDL BufferSource positions (Blob parts, a DecompressionStream's input, TextDecoder):
// the page reads the bytes it was handed, a subarray's own window included (over a shared module memory the host
// hands such positions a copy: tests/wasmgc-link/unshared-views).
async function main(): Promise<void> {
  const bytes = new Uint8Array([104, 105, 33, 0, 7]);
  const blob = new Blob([bytes.subarray(0, 3) as BlobPart]);
  console.log(blob.size, await blob.text());
  console.log(new TextDecoder().decode(bytes.subarray(0, 2)));
  const gz = new Uint8Array([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 203, 200, 4, 0, 172, 42, 147, 216, 2, 0, 0, 0]);
  const stream = new Blob([gz as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  console.log(new TextDecoder().decode(new Uint8Array(await new Response(stream).arrayBuffer())));
}
void main();
