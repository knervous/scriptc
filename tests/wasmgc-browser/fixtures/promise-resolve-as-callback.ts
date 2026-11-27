// A promise's resolve function handed straight to a host callback slot (`setTimeout(resolve, ms)`), raced and joined
// the way a splash waits on several things with a deadline (character select, 10-25).
const wait = (ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
async function main(): Promise<void> {
  await wait(5);
  console.log("direct resolve fired");
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const all = Promise.all([wait(1), gate, new Promise<void>((resolve) => { setTimeout(resolve, 2); })]).then(() => "all");
  setTimeout(() => release(), 3);
  console.log(await all);
  const never = new Promise<string>(() => {});
  console.log(await Promise.race([never, wait(4).then(() => "deadline")]));
  console.log(await Promise.race([new Promise<string>((resolve) => { setTimeout(() => resolve("first"), 1); }), wait(50).then(() => "late")]));
}
void main();
