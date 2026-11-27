// Constructor struct fields typed from the site profile's field representations (a property set
// from a parameter that V8 only ever saw hold Smis), and int consumers of i32 fields: switch
// labels, === against numbers, unboxed field-to-field copies and int locals. The profile
// (js-ctor-structs-profiled.profile.json) records every o.<field> site of this file.
function Cell(tag, mode) {
  this.tag = tag;
  this.key = null;
  this.mode = mode;
  this.flags = 0;
  this.lanes = 0;
  this.child = null;
}
export function make(tag, mode) { return new Cell(tag, mode); }
export function kind(o) {
  switch (o.tag) {
    case 0: return "fn";
    case 1: return "class";
    case 3: return "root";
    case 5: return "host";
    case 6: return "text";
    case 7: case 8: return "frag";
    case 7: return "dup";
    default: return "other:" + String(o.tag);
  }
}
export function wide(o) {
  switch (o.mode) { case 1: return "a"; case 1000: return "b"; case -5: return "c"; default: return "d"; }
}
export function flagsOf(o) {
  var flags = o.flags, out = "";
  if (flags & 1) out += "p";
  if (flags & 4) out += "u";
  if ((flags & 6) === 6) out += "!";
  return (out || "-") + (flags === 0 ? "0" : "");
}
export function isHost(o) { return 5 === o.tag || o.tag === 6 ? "host" : o.tag !== 3 ? "no" : "root"; }
export function copy(o, b) {
  o.lanes = b.lanes; o.flags = b.flags & 12; o.mode = b.mode; o.tag = 2;
  return o.lanes + "/" + o.flags + "/" + o.mode + "/" + o.tag;
}
export function bump(o, lanes) {
  if ((o.lanes & lanes) !== lanes) o.lanes |= lanes;
  o.flags = o.flags | 1;
  return o.lanes + "/" + o.flags;
}
export function setTag(o, v) { o.tag = v; return o.tag; }
export function setMode(o, v) { o.mode = v; return o.mode; }
