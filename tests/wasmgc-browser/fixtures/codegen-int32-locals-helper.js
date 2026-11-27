// Int32 narrowing in JavaScript sources: f64 globals that only ever hold int32
// values seed i32 locals (React lane/flag constants), hoisted `var` locals
// qualify, and comparisons of int-valued operands compare integers. Globals
// later assigned a non-int32, uint32 values, results beyond int32 and
// coercing operands (strings, valueOf, NaN, -0) keep JS semantics.
var NoLanes = 0, SyncLane = 2, Big = 2147483647, Neg = -2147483648, Flags = 524288;
var Mutated = 0; // later assigned a non-int32
var Halfway = 5; // later assigned another int
var UBig = 4294967295 >>> 0;
export function setGlobals() { Mutated = 1.5; Halfway = 7 | 0; }
export function lanes(fibers) {
  var merged = NoLanes, flags = NoLanes, count = 0;
  for (var i = 0; i < fibers.length; i++) {
    var f = fibers[i];
    merged = merged | f.lanes | f.childLanes;
    flags |= f.flags & ~SyncLane;
    if ((f.flags & Flags) !== NoLanes) count++;
    if ((merged & SyncLane) === NoLanes) count += 10;
  }
  var mut = Mutated, half = Halfway;
  var u = UBig, cmp = [];
  var s1 = merged | 0, s2 = flags >> 1, s3 = -1 >>> 0, s4 = Neg | 0;
  cmp.push(s1 < s2, s1 <= s2, s1 > s2, s1 >= s2, s1 === s2, s1 !== s2, s3 > s4, s3 === 4294967295, (s4 | 0) < 0, s3 > 0, u === s3, u > Big, (Big + 1) | 0, Neg < Big);
  var mixed = merged & 3; mixed = mixed + 0.5;
  return [merged, flags, count, mut, half, cmp.join(), mixed, Big | 0, (Big + 1) | 0, Flags << 13, (Flags << 13) < 0].join(" ");
}
export function hoisted(flag) { var r = []; var early = flag ? 5 | 0 : 1 << 30; r.push(early, early * 4, early + early, -early, early / 2); var inner; for (var j = 0; j < 3; j++) { inner = (j << 30) | 0; r.push(inner, inner < 0, inner === -2147483648); } return r.join(","); }
