// A `const` local holding a capturing closure is called straight to its function with the closure's environment: the
// captured bindings stay shared (a later write is seen), the same closure still works as a value, and a self-recursive
// one behaves as in Node.
function run(seed: number): string {
  let scale = seed;
  const mul = (x: number): number => x * scale;
  const out: number[] = [mul(2)];
  scale = 10;
  out.push(mul(3));
  const fns = [mul];
  out.push(fns[0]!(4));
  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
  out.push(fact(5));
  const label = (s: string, k: number): string => `${s}:${k * scale}`;
  return `${out.join(",")} ${label("a", 2)}`;
}
console.log(run(3));
