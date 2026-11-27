// @options: {"hostHandles": true}
// @native-any-only: the any-typed primitives and page objects meet the page only in the native any model
// Method calls and member reads on a PRIMITIVE receiver (a string, number, boolean or symbol that is untyped, or crossed from a page object) run the compiled library;
// only genuine host objects reach the host (React: node.nodeName.toLowerCase(), type.toLowerCase().indexOf("on")).
import { react, strings, numbers, booleans, symbols, dump } from './s-primitive-members-helper.js';
const g = globalThis as any;
const node = new g.Object();
node.nodeName = "INPUT";
const evt = new g.Object();
evt.type = "onClick";
evt.n = 12.345;
evt.flag = true;
evt.sym = g.Symbol.for("desc");
evt.text = "Hello World";
react(node, evt.type);
strings(evt.text);
strings("Hello World" as any);
numbers(evt.n);
numbers(12.345 as any);
booleans(evt.flag);
booleans(true as any);
symbols(evt.sym);
console.log(dump());
