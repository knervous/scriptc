// @native-any-only: compound assignment (|=, &=, +=, ++) to a field through a structural type a class implements, via `x!.f`, a narrowed
// property path, a module variable and a nullable field, and the null case (a TypeError like Node).
type Fiber = { flags: number; tag: number; child: Fiber | null; sibling: Fiber | null };
class FiberNode implements Fiber {
  flags = 0; tag: number; child: Fiber | null = null; sibling: Fiber | null = null;
  constructor(tag: number) { this.tag = tag; }
}
let current: Fiber | null = null;
function mark(f: Fiber, bit: number): void { f.flags |= bit; f.flags &= ~4; f.tag += 1; }
const a = new FiberNode(1);
const rec: Fiber = { flags: 1, tag: 2, child: a, sibling: null };
current = rec;
current!.flags |= 8;
mark(a, 2 | 4 | 16);
mark(rec, 32);
rec.child!.flags |= 64;
if (rec.child !== null) rec.child.flags += 1;
if (rec.child !== null) rec.child.flags++;
const tail: Fiber | null = rec.sibling;
try { tail!.flags |= 1; } catch (e) { console.log("TypeError", e instanceof TypeError); }
console.log(a.flags, a.tag, rec.flags, rec.tag, current!.flags);
