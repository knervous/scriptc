// @native-any-only: array destructuring ASSIGNMENT from an awaited page value (`[result] = await Promise.all([...])`) in an async
// function: the source is a page array, so the pattern steps the page's own iteration; a page-value source used to emit an
// ill-typed local (react-router's callLoaderOrAction).
export {};
const page: any = globalThis;
async function pick(h: any, other: any): Promise<any> {
  let result: any;
  try {
    [result] = await Promise.all([Promise.resolve(h), other]);
  } catch (e) {
    return { type: "error" };
  }
  return result;
}
async function two(a: any, b: any): Promise<any> {
  let x: any, y: any;
  [x, y] = await Promise.all([Promise.resolve(a), Promise.resolve(b)]);
  return [y, x];
}
async function main(): Promise<void> {
  console.log(await pick(5, 6));
  console.log(await pick({ k: "v" }, null));
  console.log((await two("a", "b")).join(","));
  console.log(typeof page);
}
main();
