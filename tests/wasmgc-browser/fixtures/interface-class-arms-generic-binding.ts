// @options: {"interfaceClassArms": true}
// A type parameter bound to a plain record maps to that record: the record's
// arms are looked up by the record's own shape, never by a shape id of another
// registry (the lowerer numbers shapes differently from the arms scan, here
// because the scan also walks `neverCalled`). Classes flowing into Vec and Solo
// must not become arms of the Pair that `parse` and `define` are bound to.
interface Codec<T> { decode(b: number): T | null; encode(v: T): number }
interface Dead1 { d1: number }
interface Dead2 { d2: number }
export function neverCalled(): number { const a: Dead1 = { d1: 1 }; const b: Dead2 = { d2: 2 }; return a.d1 + b.d2; }
interface Vec { x: number; y: number }
class Pos { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
class Pos2 { x = 3; y = 4; extra = 1; }
interface Tag { id: number }
interface Pair { left: number; right: number }
interface Solo { store: number }
class Cell { store = 7; }
function lenOf(v: Vec): number { return v.x + v.y; }
function tagOf(t: Tag): number { return t.id; }
function sumPair(p: Pair): number { return p.left + p.right; }
function readSolo(s: Solo): number { return s.store; }
const tagCodec: Codec<Tag> = { decode: (b) => (b > 0 ? { id: b } : null), encode: (v) => v.id };
const pairCodec: Codec<Pair> = { decode: (b) => (b > 0 ? { left: b, right: b + 1 } : null), encode: (v) => v.left + v.right };
const soloCodec: Codec<Solo> = { decode: (b) => (b > 0 ? { store: b } : null), encode: (v) => v.store };
function parse<T>(codec: Codec<T>, b: number): T {
  const value = codec.decode(b);
  if (value === null) throw new Error("none");
  return value;
}
function define<T>(codec: Codec<T>): { decode(b: number): T; encode(v: T): number } {
  return Object.freeze({
    decode(b: number): T {
      const value = b > 1 ? codec.decode(b) : null;
      if (value === null) throw new Error("none");
      return value;
    },
    encode(v: T): number { return codec.encode(v); },
  });
}
const M1 = define(tagCodec);
const M2 = define(pairCodec);
const M3 = define(soloCodec);
console.log(lenOf(new Pos(1, 2)), lenOf(new Pos2()), readSolo(new Cell()));
console.log(tagOf(parse(tagCodec, 3)), sumPair(parse(pairCodec, 3)), parse(soloCodec, 5).store);
console.log(M1.decode(4).id, M2.decode(4).left, M3.decode(4).store, M1.encode({ id: 9 }), tagOf({ id: 2 }), sumPair({ left: 1, right: 2 }));
// @expect: 3 7 7
// @expect: 3 7 5
// @expect: 4 4 4 9 2 3
