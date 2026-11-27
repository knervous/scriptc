// @native-only: a page-backed record crosses to the page as its page object only under the native object model
// Page functions returning promises of different payloads each exit by their own payload type: the adapter
// helpers were named by a key that drops a promise's payload, so the first `() => Promise<string>` decided
// how `() => Promise<Item[]>` settled (the client's WebHID `getDevices()` refused as another payload's promise).
interface Item { readonly n: number }
interface Body {
  text(): Promise<string>;
  json(): Promise<Item[]>;
}
async function main(): Promise<void> {
  const a: Body = new Response("hello");
  const b: Body = new Response('[{"n":1},{"n":2}]');
  const text = await a.text();
  const items = await b.json();
  console.log(text, items.length, items.map((i) => i.n).join("+"));
}
void main().catch((e: unknown) => console.log("ERR", String(e)));
