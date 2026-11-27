export function run() {
  function* inner() { const x = yield 1; return x; }
  function* outer() { const r = yield* inner(); yield r; }
  const it = outer();
  it.next();
  return String(it.next(5).value);
}
