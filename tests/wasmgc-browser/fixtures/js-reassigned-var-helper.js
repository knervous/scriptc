// A JS variable whose initializer has a static type is later reassigned a
// value of another kind (React's resolveUpdatePriority reuses one var for a
// number and then window.event). tsc narrows reads through the declared
// type; the value actually stored must win.
var Internals = { d: null, p: 0 };
var Other = { n: 1, s: "s" };
export function resolve(next) {
  var priority = Internals.p;
  if (0 !== priority) return priority;
  priority = next;
  return void 0 === priority ? 32 : typeof priority === "string" ? "str:" + priority : typeof priority;
}
export function reuse(flag) {
  var label = Other.s;
  if (flag) label = Other.n + 1;
  var count = Other.n;
  count = flag ? null : count + 1;
  return [typeof label, label, count === null ? "null" : count];
}
export function report() {
  const lines = [];
  lines.push(`resolve: ${resolve(undefined)} ${resolve("x")} ${resolve({})} ${resolve(5)}`);
  Internals.p = 8;
  lines.push(`resolve set: ${resolve("ignored")}`);
  lines.push(`reuse: ${JSON.stringify(reuse(true))} ${JSON.stringify(reuse(false))}`);
  return lines.join("\n");
}
