// String.prototype.slice with an untyped end: the end's valueOf runs once.
let trace = "";
function receiver() { trace += "r"; return "abcd"; }
/** @param {unknown} start @param {unknown} finish */
function both(start, finish) { return receiver().slice(start, finish); }
export function run() {
  const position = { valueOf() { trace += "v"; return "1.9"; } };
  const finish = { valueOf() { trace += "f"; return 3; } };
  const a = both(position, finish) + " " + trace;
  trace = "";
  const b = both(0, { valueOf() { trace += "g"; return -1; } }) + " " + trace;
  return a + " | " + b;
}
