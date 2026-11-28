// A string spread into a page function's arguments spreads its characters (code points), as Node does: a dynamic and
// a typed page callee, with and without a fixed argument before the spread, over plain, empty and astral strings
// held as `any` and as `string`.
const page: any = globalThis;
const typed = (globalThis as any).auditPageList as (...xs: string[]) => HTMLCollection;
const show = (list: any): string => list.length + ":" + list.join("|");
const sources: any[] = ["ab", "", "x\u{1F600}y"];
for (const v of sources) {
  const s: string = v;
  console.log("dyn", show(page.auditPageList(...v)), show(page.auditPageList("a", ...v)), show(page.auditPageList(...s)));
  const t: any = typed(...v), u: any = typed("a", ...s);
  console.log("typed", show(t), show(u));
}
