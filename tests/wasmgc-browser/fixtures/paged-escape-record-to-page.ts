// A closure stored in a record that crosses to the page, then called by page
// JS with a plain page object: the argument is a page-backed record.
interface EscA { n: number; }
interface EscBox { cb: (a: EscA) => number; label: string; }
const page: any = globalThis;
const box: EscBox = { cb: (a) => a.n + 1, label: "box" };
page.auditKeep(box);
const kept = page.auditKept();
console.log(page.auditCallWith(kept.cb, undefined, page.auditMake()), kept.label);
