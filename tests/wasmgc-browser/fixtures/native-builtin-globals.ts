// @options: {"hostHandles": true}
// @native-only: the engine lane has no lowering for `instanceof` an error constructor over an untyped value (dyn.errInstanceof), before and after this change
// The language's own constructors reached through page values on the native host (which has no page Object, Promise or Error
// globals): a getter read through Object.getOwnPropertyDescriptor on a page prototype, a page error tested with instanceof, and
// Promise.all over page promises. Each is the compiled constructor, never a page global read that answers undefined.
const url = new URL("http://example.test/path?q=1");
const href = Object.getOwnPropertyDescriptor(URL.prototype, "href")?.get?.call(url);
console.log(typeof href, href);
let caught: unknown = null;
try { new URL("not a url"); } catch (e) { caught = e; }
console.log(caught instanceof TypeError, caught instanceof Error, caught instanceof RangeError);
async function main(): Promise<void> {
  const page = [new Response("a").text(), new Response("bc").text()];
  const texts = await Promise.all(page);
  console.log(texts.join("+"));
}
main();
