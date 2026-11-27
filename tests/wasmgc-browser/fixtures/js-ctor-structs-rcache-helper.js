// Receiver caches on constructor-struct sites: a local known to hold a complete struct skips the
// type and clean-flag tests at later sites on it, until the local is redefined or code runs that
// could convert an object. The profile (js-ctor-structs-rcache.profile.json) records every
// o.<field> site of this file.
function Node(tag, val, next) {
  this.tag = tag;
  this.lanes = 0;
  this.val = val;
  this.next = next;
}
export function make(tag, val, next) { return new Node(tag, val, next); }
// Many reads on one local; the local is redefined each iteration.
export function walk(o) {
  var out = "";
  while (o !== null) {
    out += o.val + ":" + o.tag + (o.tag === 3 ? "!" : "") + (o.lanes & 1) + ",";
    o.lanes = o.lanes | 2;
    o = o.next;
  }
  return out;
}
// Code between two reads converts the object: the second read must see the generic object.
export function across(o, f) {
  var a = o.tag + o.lanes;
  f(o);
  var b = o.tag + "/" + o.lanes + "/" + o.val + "/" + o.extra;
  o.tag = 9;
  return a + "|" + b + "|" + o.tag + "|" + o.extra;
}
// The value of a write redefines the receiver local: the write still goes to the old object.
export function swapWrite(o, p) {
  var t = o.tag;
  o.lanes = (o = p).tag | 4;
  return t + "/" + o.lanes;
}
export function swapWriteF(o, p) {
  var t = o.tag;
  o.lanes = (o = p).tag * 2;
  return t + "/" + o.lanes;
}
export function swapRead(o, p) {
  var t = o.tag;
  var u = (o = p).tag | 0;
  return t + "/" + u + "/" + o.val;
}
// A typed field takes a value it cannot hold: the object converts; the next site sees that.
export function widen(o, v) {
  var a = o.lanes;
  o.lanes = v;
  return a + "/" + o.lanes + "/" + o.tag;
}
export function drop(x) { delete x.val; }
