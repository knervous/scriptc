// Library classes extending builtins (immer's DraftMap/DraftSet, a Stack over
// Array) defined at module scope: defining them must not throw, whether or
// not the program constructs them (a construction may refuse at run time).
var DraftMap = class extends Map {
  constructor(target) { super(); this.target_ = target; }
  get size() { return 7; }
};
class DraftSet extends Set { add(v) { return super.add(v); } }
class Stack extends Array {}
var Problem = class extends Error { constructor(m) { super(m), this.name = "Problem"; } };
export function run(useBuiltins) {
  var out = [typeof DraftMap, typeof Problem];
  var p = new Problem("bad");
  out.push(p.message, p.name, p instanceof Error, String(p));
  if (useBuiltins) out.push(new DraftMap({}).size, new DraftSet().add(1).size, new Stack().length);
  return out.join("|");
}
