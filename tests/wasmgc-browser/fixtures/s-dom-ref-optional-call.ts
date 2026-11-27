// @options: {"hostHandles": true}
// DOM members called through an optional chain on a DOM-typed receiver whose value is checked-dynamic (a React ref's `.current`, read in compiled JS): the page value runs the member.
import { useRef } from './s-dom-ref-optional-call-helper.js';
const h: any = globalThis;
const dom = h.auditDom();
const el: HTMLElement = dom.doc.createElement("div");
const child: HTMLElement = dom.doc.createElement("span");
el.appendChild(child);
dom.log();
const ref = useRef<HTMLElement | null>(el);
console.log(ref.current?.contains(child), ref.current?.contains(el), ref.current?.getBoundingClientRect()?.width);
ref.current?.focus({ preventScroll: true });
ref.current?.focus();
if (ref.current?.contains(child)) console.log("inside");
const empty = useRef<HTMLElement | null>(null);
console.log(empty.current?.contains(child), empty.current?.focus(), empty.current?.getBoundingClientRect());
const rr: any = useRef(el);
const typed: HTMLElement | null = rr.current;
console.log(typed?.contains(child), (rr.current as HTMLElement | null)?.contains(el));
console.log(dom.log());
