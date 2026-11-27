// Module-level bindings: the match results live in untyped (dyn) slots.
const hit = "port:8080".match(/(?<name>\w+):(?<port>\d+)/);
const re = /(?<d>\d)/g;
const first = re.exec("a1b2");
const all = "a1b2".match(re);
export function matches() {
  const out = [];
  if (hit) out.push(hit.groups.name, hit.groups.port, hit.index, hit.input);
  out.push(first.groups.d, first.index, re.lastIndex);
  out.push(JSON.stringify(all), String(all.index));
  return out.join(" ");
}
