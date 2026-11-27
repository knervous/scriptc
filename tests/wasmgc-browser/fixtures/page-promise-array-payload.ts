// @native-any-only: a page promise that settles with an array or a record, awaited at a typed `Promise<T[]>` / `Promise<R>`
// (`await navigator.hid.getDevices()`): the settled page data is checked into the compiled type.
export {};
const fromJson = (text: string): Promise<any> => fetch("data:application/json," + text).then((r) => r.json());
const pageList = (): Promise<number[]> => fromJson("[1,2,3]");
async function main(): Promise<void> {
  const xs = await pageList();
  console.log(xs.length, xs.map((n) => n * 2).join(","));
  const empty: Promise<string[]> = fromJson("[]");
  console.log((await empty).length);
  const rec: Promise<{ done: boolean; value: number }> = fromJson('{"done":true,"value":7}');
  const r = await rec;
  console.log(r.done, r.value);
}
main();
