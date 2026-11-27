// @options: {"interfaceClassArms": true}
// A class instance written into a page-resident holder typed by an interface, read back through the page.
interface Pos { x: number; y: number }
class Tagged implements Pos { x: number; y: number; tag: string; constructor(x: number, y: number, tag: string) { this.x = x; this.y = y; this.tag = tag; } }
const h: any = globalThis;
const origin: { current: Pos } = h.auditIdentity({ current: { x: 0, y: 0 } });
origin.current = new Tagged(9, 10, "u");
console.log(origin.current.x, origin.current.y);
console.log((h.auditIdentity(origin).current as any).tag);
