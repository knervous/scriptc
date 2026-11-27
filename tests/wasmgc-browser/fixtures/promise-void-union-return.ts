// Functions typed `Promise<void> | void` awaited, queued and chained.
interface Scene { queue: number[]; builders: (() => void | Promise<void>)[]; }
function drain(scene: Scene): Promise<void> | void {
  if (!scene.queue[0]) return;
  const n = scene.queue.length;
  scene.queue.length = 0;
  return (async () => { console.log("drained", n); })();
}
type Hook = (n: number) => Promise<void> | void;
const hooks: Hook[] = [
  async (n) => { console.log("async", n); },
  (n) => { console.log("sync", n); },
];
async function run(h: Hook, n: number): Promise<void> {
  const r = h(n);
  if (r) await r;
  await h(n + 1);
}
async function main(): Promise<void> {
  for (const h of hooks) await run(h, 1);
  const scene: Scene = {
    queue: [1, 2],
    builders: [async () => { console.log("b1"); }, () => { console.log("b2"); }],
  };
  await drain(scene);
  await drain(scene);
  const pending = drain({ queue: [3], builders: [] });
  if (pending) await pending;
  for (const b of scene.builders) await b();
  await Promise.all(scene.builders.map(async (b) => { await b(); }));
  console.log("done");
}
main();

// The scene-build shapes: Promise.all over callbacks answering Promise<void> | void,
// over optional hooks, and an awaited optional hook call.
interface Task { _preload?: () => Promise<void>; }
interface Ctx { builders: (() => void | Promise<void>)[]; tasks: Task[]; rebuild?: (c: Ctx) => Promise<void>; }
async function build(ctx: Ctx): Promise<void> {
  while (ctx.builders.length) {
    const builders = ctx.builders.splice(0);
    await Promise.all(builders.map((b) => b()));
  }
  await Promise.all(ctx.tasks.map((task) => task._preload?.()));
  await ctx.rebuild?.(ctx);
  console.log("built");
}
void build({
  builders: [async () => { console.log("pb1"); }, () => { console.log("pb2"); }],
  tasks: [{ _preload: async () => { console.log("pre"); } }, {}],
  rebuild: async () => { console.log("rebuilt"); },
}).then(() => build({ builders: [], tasks: [] }));
