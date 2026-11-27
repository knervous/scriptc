// Object.freeze of typed records (record.freeze) and the width copies that keep the level (record.inherit): writes to
// a frozen record throw Node's TypeError in strict code and leave it unchanged; copies of it stay frozen; its
// untyped view is frozen; an unfrozen record of the same shape stays writable and is released as usual.
interface Options { size: number; label: string; tags?: Record<string, number> }
interface Narrow { size: number }
function attempt(what: string, write: () => void, message = true): void {
  try { write(); console.log(what, "wrote"); }
  catch (error) { console.log(what, error instanceof TypeError ? `TypeError${message ? `: ${error.message}` : ""}` : "other"); }
}
function freezeIt(options: Options): Options { return Object.freeze(options); }
function narrow(n: Narrow): Narrow { return n; }
const frozen = freezeIt({ size: 1, label: "a", tags: { x: 1 } });
const open: Options = { size: 2, label: "b" };
attempt("frozen size", () => { frozen.size = 5; });
attempt("frozen label", () => { frozen.label = "z"; });
attempt("open size", () => { open.size = 6; });
console.log(frozen.size, frozen.label, open.size, Object.isFrozen(frozen), Object.isFrozen(open));
const copy = narrow(frozen);
attempt("copy size", () => { copy.size = 9; });
console.log(copy.size, Object.isFrozen(copy));
const view: any = frozen;
// (The untyped write's message is the runtime's generic frozen-object text, not V8's: the class only.)
attempt("untyped write", () => { view.size = 10; }, false);
console.log(frozen.size, JSON.stringify(frozen));
for (let i = 0; i < 3; i++) {
  const fresh = freezeIt({ size: i, label: `n${i}` });
  attempt(`fresh ${i}`, () => { fresh.size = 100; });
}
