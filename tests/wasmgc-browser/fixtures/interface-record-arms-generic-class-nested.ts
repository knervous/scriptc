// @options: {"interfaceClassArms": true}
// Generic class instantiations reach a structural slot through array
// callbacks (flatMap/map) and record-to-record flows, not only direct
// assignments: each instantiation is an arm of the slot field.
class Observable<T> {
  private subs: ((arg: T) => void)[] = [];
  add(cb: (arg: T) => void): () => void { this.subs.push(cb); return () => {}; }
  notify(arg: T): void { for (const s of this.subs) s(arg); }
}
interface Vec { x: number }
class Mover { onMove = new Observable<Vec>(); }
class Spinner { onSpin = new Observable<number>(); }
class Sizer { onSize = new Observable<Vec>(); }
const mover = new Mover();
const spinner = new Spinner();
const sizer = new Sizer();
interface Entry { label: string; changed: { add(cb: () => void): unknown } }
let entries: Entry[] = [];
let fired = 0;
const kind: number = 1;
if (kind === 0) {
  entries = [mover, undefined].flatMap((m) => m ? [{ label: "move", changed: m.onMove }] : []);
} else if (kind === 1) {
  entries = [
    { label: "spin", changed: spinner.onSpin },
    { label: "move", changed: mover.onMove },
  ];
} else {
  entries = [sizer].map((s) => ({ label: "size", changed: s.onSize }));
}
for (const e of entries) e.changed.add(() => { fired += 1; });
mover.onMove.notify({ x: 1 });
spinner.onSpin.notify(2);
sizer.onSize.notify({ x: 3 });
console.log(entries.length, fired);
const viaMap = [sizer, new Sizer()].map((s) => ({ label: "size", changed: s.onSize }));
const asEntries: Entry[] = viaMap;
asEntries[0]!.changed.add(() => { fired += 100; });
sizer.onSize.notify({ x: 4 });
console.log(asEntries.length, fired);
// Two instantiations, each reaching the slot only through an array of fresh
// records assigned to an array of the wider record type.
const moveEntries = [mover].map((m) => ({ label: "move", changed: m.onMove }));
const spinEntries = [spinner].map((s) => ({ label: "spin", changed: s.onSpin }));
let wide: Entry[] = moveEntries;
wide[0]!.changed.add(() => { fired += 1000; });
mover.onMove.notify({ x: 5 });
wide = spinEntries;
wide[0]!.changed.add(() => { fired += 10000; });
spinner.onSpin.notify(6);
console.log(wide.length, fired);
