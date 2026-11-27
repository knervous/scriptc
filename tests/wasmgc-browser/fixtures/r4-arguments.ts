// Calling an untyped JS function with more arguments than it declares: `arguments` sees all of them.
import { children, childArray, tree, makeElement, describeIt, createEl2 } from './r4-arguments-helper.js';
const a: string = children("div", null, "x");
const b: string = children("div", null, "x", "y", "z");
const c: string = children("div", null);
const d: string = childArray("ul", null, "only");
const e: string = childArray("ul", null, "p", "q", "r");
const t: string = tree();
// A dynamic call (the callee is an untyped value) with surplus arguments.
const mk: any = makeElement();
const viaDyn: string = describeIt(mk("div", null, mk("b", null, "x"), mk("i", null, "y")));
// A function expression on an exports-like object (React's createElement shape), called through its import.
const viaExport: string = describeIt(createEl2("div", null, createEl2("b", null, "x"), createEl2("i", null, "y")));
console.log(a, b, c, d, e, t, viaDyn, viaExport);
