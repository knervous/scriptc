// Calling a method through a union of classes and an interface record: each
// class arm runs its own method (virtual where overridden), the record arm
// calls its function field; a void method and a value-returning one.
interface Region { minX: number; maxX: number }
interface Streamer {
  applyRegion: (regions: Region[]) => void;
  covered: (x: number) => boolean;
}
class PhysicsStreamer {
  count = 0;
  applyRegion(regions: Region[]): void { this.count += regions.length; }
  covered(x: number): boolean { return x > 0; }
}
class ObjectLayer {
  last = 0;
  applyRegion(regions: Region[]): void { this.last = regions[0]?.maxX ?? -1; }
  covered(x: number): boolean { return x === this.last; }
}
class WideLayer extends ObjectLayer {
  override covered(x: number): boolean { return x >= this.last; }
}
function apply(s: Streamer | PhysicsStreamer | ObjectLayer, regions: Region[]): boolean {
  s.applyRegion(regions);
  return s.covered(5);
}
const p = new PhysicsStreamer();
const o = new ObjectLayer();
const w = new WideLayer();
let seen = 0;
const literal: Streamer = { applyRegion: (r) => { seen += r.length * 10; }, covered: (x) => x === 7 };
console.log(apply(p, [{ minX: 0, maxX: 1 }]), apply(o, [{ minX: 0, maxX: 5 }]), apply(w, [{ minX: 0, maxX: 3 }]), apply(literal, [{ minX: 0, maxX: 1 }, { minX: 1, maxX: 2 }]));
console.log(p.count, o.last, w.last, seen);
