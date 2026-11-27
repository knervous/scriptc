// @native-any-only: the Blob part crossing; the plain native lane fences a compiled ArrayBuffer in a page-typed any (page-array-buffer-alias-refusal covers adoption there)
// A page ArrayBuffer (a fetch/Blob result) entering compiled code is copied in at the crossing, once per page
// buffer: views with an offset and DataViews work, every view aliases the others (writes show through), views
// share the buffer itself as `.buffer`, and the buffer goes back out to the page (a Blob part) with the compiled writes in it.
async function main(): Promise<void> {
  const buffer = await new Response(new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80])).arrayBuffer();
  const tail = new Uint8Array(buffer, 4, 3);
  const dv = new DataView(buffer, 2);
  console.log(buffer.byteLength, tail[0], tail.length, dv.getUint8(0), dv.byteLength);
  tail[1] = 99;
  const whole = new Uint8Array(buffer);
  console.log(whole[5], dv.getUint8(3), tail.buffer === buffer, new Uint8Array(buffer).buffer === buffer, whole.buffer === tail.buffer);
  const words = new Uint32Array(buffer, 0, 2);
  console.log(words.length, (words[0]! & 0xff) === 10);
  const blob = new Blob([buffer]);
  const back = new Uint8Array(await blob.arrayBuffer());
  console.log(blob.size, Array.from(back).join(","));
  const header = new Uint8Array(buffer.slice(0, 2));
  console.log(header[0], header[1], buffer.slice(6).byteLength);
}
void main();
