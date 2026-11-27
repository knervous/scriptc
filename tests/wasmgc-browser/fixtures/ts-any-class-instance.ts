// A compiled class instance held through TS any, or handed to the page, is
// readable and writable there: fields, getters, setters and methods (the
// class bridge's page facade), with identity kept across the round trip.
const h: any = globalThis;
class Box { n = 1; get twice() { return this.n * 2; } inc() { this.n++; return this.n; } }
const b: any = new Box();
console.log(b.n, b.twice, b.inc(), b.n);
const vals: any[] = [new Box()];
console.log(vals[0].n);
class Plain { a = 1; b = "x"; }
console.log(h.auditKeys(new Plain()), JSON.stringify(b), JSON.stringify(new Plain() as any));
const box = new Box();
h.auditMutate(box);
console.log(box.n, box.twice);
h.auditKeep(box);
const back: Box = h.auditKept();
console.log(back === box, h.auditKept() === h.auditKept());
class Shape {
  w = 2; h = 3;
  get area(): number { return this.w * this.h; }
  set size(v: number) { this.w = v; this.h = v; }
  describe(prefix: string): string { return prefix + ":" + this.area; }
}
class Square extends Shape { label = "sq"; describe(prefix: string): string { return "square " + super.describe(prefix); } }
const sq = new Square();
const s: any = sq;
console.log(s.area, s.describe("p"), s.label, h.auditKeys(s));
s.size = 5;
console.log(sq.w, sq.area, s.area);
h.auditTouch({ n: 2 });
const bag = { inst: sq, list: [new Shape(), sq] };
h.auditKeep(bag);
const kept: any = h.auditKept();
console.log(kept.inst === s, kept.list[1] === s, kept.list[0].describe("q"));
console.log(sq, s, new Plain());
