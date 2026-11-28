// A page function called with a non-iterable spread into its arguments throws V8's TypeError, as Node does: a
// dynamic callee and a typed page callee, each with a number, a plain object, a boolean, null, undefined, a typed
// record and a class instance.
const page: any = globalThis;
const typed = (globalThis as any).auditPageList as (...xs: string[]) => HTMLCollection;
class Point { x = 1; }
const record = { a: 1, b: "two" };
const sources: any[] = [5, { a: 1 }, true, null, undefined, record, new Point()];
const report = (label: string, run: () => unknown): void => {
  try {
    run();
    console.log(label, "no throw");
  } catch (e) {
    console.log(label, (e as Error).name, (e as Error).message);
  }
};
for (const v of sources) {
  report("dyn", () => page.auditPageList(...v));
  report("dyn after", () => page.auditPageList("a", ...v));
  report("typed", () => typed(...v));
  report("typed after", () => typed("a", ...v));
}
