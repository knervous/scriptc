// An unchecked read (`handlers[0]` may be undefined at run time) keeps the
// binding's temporal dead zone: reading it before its declaration throws.
function early(): string {
  try { return String(lateFirst ? lateFirst(1) : "none"); } catch (e) { return e instanceof ReferenceError ? "tdz" : "other"; }
}
console.log(early());
// A top-level const bound to a function read from an array / record / map /
// optional call: the module-level binding holds a closure, and is read from
// functions declared before it initializes.
const handlers: ((n: number) => number)[] = [(n) => n + 1, (n) => n * 2];
const first = handlers[0]!;
const second = handlers.at(1)!;
const byName: Record<string, (n: number) => number> = { inc: (n) => n + 1, neg: (n) => -n };
const neg = byName["neg"]!;
const nested = [{ run: () => "A" }];
const fromMap = nested[0]!.run;
const maybe: ((n: number) => number) | undefined = handlers.length > 1 ? handlers[1] : undefined;
function useAll(n: number): number {
  return first(n) + second(n) + neg(n) + (maybe ? maybe(n) : 0) + fromMap().length;
}
console.log(first(1), second(4), neg(3), fromMap(), maybe?.(5));
console.log(useAll(10));
const lateFirst = handlers[0];
const lateMissing = handlers[5];
console.log(early(), lateFirst ? lateFirst(9) : -1, lateMissing === undefined);
