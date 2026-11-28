// Parameters defaulted to a no-op: whatever function the caller passes is what they call, and what they return.
export const noop = () => {};
const call = (f = noop) => f();
function callBack(f = noop) { const r = f(); return r; }
const label = (anchor, id = noop, title = noop) => anchor + ":" + id() + ":" + title();
export function run() {
  let out = "" + call(() => "a");
  out += " " + call(() => 3);
  out += " " + callBack(() => "b");
  out += " " + label("n", () => "run", () => "Create");
  out += " " + label("m");
  return out;
}
