// A dynamic callee called with a page value spread after fixed arguments (createElement(type, props, ...children)
// with a compiled createElement and children typed as a page collection): every element arrives, in order.
import { join } from "./dyn-callee-page-spread-helper.js";
const auditPageList = (globalThis as any).auditPageList as (...xs: string[]) => HTMLCollection;
const f: any = join;
console.log(f("div", null, ...auditPageList("a", "b", "c")));
console.log(f("ul", { id: 1 }, ...auditPageList()));
const kids = auditPageList("x", "y");
console.log(f("p", null, "first", ...kids));
