// @native-any-only: a generic recursive record alias/interface used inside generic functions instantiated at <unknown, unknown> and at
// concrete types; one shape per instantiation identity, so the values flow between the generic code and the concrete callers.
type Update<S, A> = { action: A; eager: S | null; next: Update<S, A> | null };
interface Ctx<T> { value: T; parent: Ctx<T> | null }
function enqueue<S, A>(head: Update<S, A> | null, action: A): Update<S, A> {
  const u: Update<S, A> = { action, eager: null, next: head };
  return u;
}
function len<S, A>(u: Update<S, A> | null): number {
  let n = 0;
  while (u !== null) { n++; u = u.next; }
  return n;
}
function depth<T>(c: Ctx<T>): number { return c.parent === null ? 1 : 1 + depth(c.parent); }
function top<T>(c: Ctx<T>): T { return c.value; }
let h: Update<unknown, unknown> | null = null;
h = enqueue<unknown, unknown>(h, 1);
h = enqueue<unknown, unknown>(h, "x");
console.log(len(h), String(h.action), String(h.next!.action));
const concrete: Update<number, string> | null = enqueue<number, string>(enqueue<number, string>(null, "a"), "b");
console.log(len(concrete), concrete.action, concrete.next!.action);
const root: Ctx<number> = { value: 1, parent: null };
const child: Ctx<number> = { value: 2, parent: root };
console.log(depth(child), top(child), depth(root));
const anyCtx: Ctx<unknown> = { value: { k: 1 }, parent: null };
console.log(depth(anyCtx), (top(anyCtx) as { k: number }).k);
