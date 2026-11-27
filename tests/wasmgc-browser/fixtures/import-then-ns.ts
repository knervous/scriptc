// A dynamic import settled into a callback taking the module namespace, that callback stored on an object with function members: the namespace never crosses dyn.
interface Ctx { timer: number | undefined; hook: ((e: number) => number) | undefined }
const engine: Ctx = { timer: undefined, hook: undefined };
const done = import("./import-then-ns-lib/lib.ts").then(({ f, a }) => {
  const t = f(a);
  if (engine.timer === undefined) engine.timer = t;
  engine.hook = (e: number) => e + f(t);
});
done.then(() => console.log(engine.timer, engine.hook ? engine.hook(1) : "none"));
