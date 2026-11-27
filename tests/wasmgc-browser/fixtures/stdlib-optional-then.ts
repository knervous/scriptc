// @options: {"interfaceClassArms": true}
// `.then` on an optional promise reached through `?.`, result discarded.
interface Dev { lost?: Promise<string> }
let disposed = false;
const run = (d: Dev | undefined): Promise<void> => new Promise<void>((resolve) => {
  void d?.lost?.then((x) => { if (disposed) return; console.log("lost", x); resolve(); });
  if (!d?.lost) resolve();
});
run({ lost: Promise.resolve("gone") }).then(() => run(undefined)).then(() => run({})).then(() => console.log("end"));
