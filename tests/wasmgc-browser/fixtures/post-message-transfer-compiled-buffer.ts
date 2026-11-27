// @native-any-only: the client's lane; the plain native lane fences a compiled ArrayBuffer in a page-typed any
// A compiled typed array posted with its buffer in the transfer list (a decode worker's request): the buffer is
// module memory, which no structured clone can detach, so the receiver gets a copy of the bytes (the transfer
// list keeps whatever else can transfer). Divergence: the compiled source is not detached afterwards.
async function main(): Promise<void> {
  const channel = new MessageChannel();
  const got = new Promise<string>((resolve) => {
    channel.port2.onmessage = (event: MessageEvent<{ id: number; bytes: Uint8Array }>) => {
      resolve(`${event.data.id}:${Array.from(event.data.bytes).join(",")}`);
    };
  });
  const bytes = new Uint8Array([3, 1, 4, 1, 5]);
  channel.port1.postMessage({ id: 7, bytes }, [bytes.buffer]);
  console.log(await got);
  channel.port1.close();
}
void main();
