// `yield*` over a delegate generator with a typed (record) next channel: the delegate starts without a next argument (its first next value is never observed) and then
// receives each value the outer generator is resumed with.
type Batch = { n: number };
type Answer = { ok: boolean };
const log: string[] = [];
function* inner(): Generator<Batch, void, Answer> {
  const a = yield { n: 1 };
  log.push("inner:" + a.ok);
}
function* outer(): Generator<Batch, number, Answer> {
  yield* inner();
  const b = yield { n: 2 };
  return b.ok ? 1 : 0;
}
const it = outer();
let r = it.next({ ok: false });
const seen: number[] = [];
if (!r.done) seen.push(r.value.n);
r = it.next({ ok: true });
if (!r.done) seen.push(r.value.n);
r = it.next({ ok: false });
console.log(log.join(","), seen.join(","), r.done, r.done ? r.value : -1);
