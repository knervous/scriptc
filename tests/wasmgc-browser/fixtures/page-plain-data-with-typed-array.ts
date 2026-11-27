// @native-only: a page object entering a record type through the native object model's page exit
// Page data entering a record type is copied through JSON only when JSON carries it faithfully: a plain object
// holding a typed array (a stream read result, a decode worker's reply with its pixels) is read from the page as
// it is used instead, so the typed array arrives as one.
interface Chunk { done: boolean; value?: Uint8Array }
interface Reply { id: number; chunk?: Chunk }
async function main(): Promise<void> {
  const reader = new Response(new Uint8Array([9, 8, 7])).body!.getReader();
  const first: Chunk = await reader.read();
  const value = first.value;
  console.log(first.done, value ? value.length : -1, value ? value[0] : -1);
  const reply: Reply = { id: 3, chunk: first };
  const held = reply.chunk?.value;
  console.log(reply.id, held ? held[2] : -1);
  const last: Chunk = await reader.read();
  console.log(last.done, last.value === undefined);
}
void main();
