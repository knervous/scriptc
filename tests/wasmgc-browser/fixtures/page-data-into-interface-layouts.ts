// @native-only: a page object entering a record union through the native object model's page exit
// @options: {"interfaceClassArms": true}
// An interface built from literals of two layouts (with and without its optional member) is a union of two
// record arms; page data entering it (a stream read result holding a typed array, a KTX2 worker's mip) goes to
// the arm that declares every field, read from the page as it is used, so its typed array arrives as one.
interface Mip { width: number; data: Uint8Array; layerIndex?: number }
function local(width: number): Mip { return { width, data: new Uint8Array(width) }; }
function layered(width: number, layerIndex: number): Mip { return { width, data: new Uint8Array(width), layerIndex }; }
interface Chunk { done: boolean; value?: Uint8Array }
async function main(): Promise<void> {
  const mips: Mip[] = [local(2), layered(3, 1)];
  console.log(mips.map((m) => `${m.width}:${m.data.length}:${m.layerIndex ?? "-"}`).join(" "));
  const reader = new Response(new Uint8Array([4, 5, 6, 7])).body!.getReader();
  const read: Chunk = await reader.read();
  const bytes = read.value!;
  const fromPage: Mip[] = JSON.parse("[]");
  fromPage.push({ width: bytes.length, data: bytes });
  const chunks: Chunk[] = [read, { done: true }];
  console.log(fromPage[0]!.data[3], chunks[0]!.value ? chunks[0]!.value[1] : -1, chunks[1]!.done);
}
void main();
