// console.log / console.error of caught values (logArg:dyn): Node's formatter rule, strings verbatim and the rest
// inspected at depth 2. The console is the stdlib one (node-env.d.ts; a lib.dom console call is a page call, the host
// island's jsval path).
function fail(kind: number): void {
  if (kind === 0) throw "plain text";
  if (kind === 1) throw { code: 7, nested: { list: [1, "two", null], deep: { deeper: { deepest: 1 } } } };
  // (A thrown array prints {} on every LLVM target today: the caught-to-dyn conversion keeps no array; not this form.)
  if (kind === 2) throw { list: ["a", { b: [true] }] };
  throw 42;
}
function run(i: number): void {
  try { fail(i); } catch (error) { console.log("caught", i, error); console.error("to stderr", error); }
}
for (let i = 0; i < 4; i++) run(i);
