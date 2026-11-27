// Dynamic import(): the namespace settles a promise (awaited, destructured, returned from a function, through .then,
// and two modules at once). An array of one namespace type (`Promise.all` over the same module) is refused.
function loadOther(): Promise<typeof import("./lib/other.js")> { return import("./lib/other.js"); }
async function main(): Promise<void> {
  const { greet } = await import("./lib/plugin.js");
  console.log(greet("await"));
  const ns = await import("./lib/plugin.js");
  console.log(ns.name, ns.greet("ns"));
  const other = await loadOther();
  console.log(other.tag, other.twice(4));
  const [{ greet: g2 }, { twice }] = await Promise.all([import("./lib/plugin.js"), import("./lib/other.js")]);
  console.log(g2("all"), twice(21));
  await import("./lib/plugin.js").then(({ greet: g }) => console.log(g("then")));
}
void main();
