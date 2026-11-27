// A function body's own `let x: T;` that a closure reads before its first store (after upstream 4a71162f4c, #3169):
// tsc's definite-assignment analysis does not reach into closures, so the binding holds undefined there, and a lazy
// initializer's `=== undefined` test has to see it. The test folded to false and the first use dereferenced null.
function lazyLocal(): number {
  let seen: Set<string>;
  const add = (s: string): number => {
    if (seen === undefined) seen = new Set();
    seen.add(s);
    return seen.size;
  };
  return add("a") + add("a") + add("b");
}
console.log(lazyLocal(), lazyLocal());

function local(): string {
  let x: number;
  const peek = (): string => typeof x;
  const before = peek();
  x = 1;
  return before + ">" + peek();
}
console.log(local());

class Store { items: string[] = []; }
function lazyStore(): string {
  let store: Store;
  const get = (): Store => (store ??= new Store());
  const put = (s: string): void => { get().items.push(s); };
  const ready = (): boolean => store !== undefined;
  const before = ready();
  put("x");
  put("y");
  return `${before} ${ready()} ${get().items.join(",")}`;
}
console.log(lazyStore());

function counted(): string {
  let total: number;
  const add = (n: number): number => (total = (total || 0) + n);
  add(2);
  const now = (): number => total;
  return `${add(3)} ${now()}`;
}
console.log(counted());

// Stored before the closure is made: the binding keeps its own storage, reads see the value.
function settled(): number {
  let n: number;
  n = 4;
  const read = (): number => n * 2;
  return read();
}
console.log(settled());
export {};
