// @options: {"interfaceClassArms": true}
// `.map` through an optional chain over `readonly T[] | undefined`.
interface Entry { name: string; zone?: string }
interface Info { characters: readonly Entry[]; count: number }
const render = (info: Info | undefined): string[] | null => info?.characters.map((c) => c.name + ":" + (c.zone ?? "-")) ?? null;
console.log(JSON.stringify(render({ characters: [{ name: "a" }, { name: "b", zone: "z" }], count: 2 })), JSON.stringify(render(undefined)));
const holder = (info: { characters?: readonly Entry[] }) => info.characters?.map((c) => c.name.length) ?? null;
console.log(JSON.stringify(holder({ characters: [{ name: "abc" }] })), JSON.stringify(holder({})));
const rows = (info: { characters?: readonly Entry[] } | undefined) => {
  const out: string[] = [];
  for (const r of info?.characters?.map((c) => c.name) ?? []) out.push(r);
  return out.join("|");
};
console.log(rows({ characters: [{ name: "x" }, { name: "y" }] }), rows(undefined), rows({}));
// Inside a heterogeneous array literal (JSX children), with a non-trivial element result.
type El = { tag: string; kids: string };
type Child = El[] | El | string | undefined | null | false;
const mk = (info: Info | null, extra: boolean): Child[] => [
  info?.characters.map((c): El => ({ tag: "button", kids: c.name })),
  extra ? { tag: "div", kids: "extra" } : null,
];
console.log(JSON.stringify(mk({ characters: [{ name: "q" }], count: 1 }, true)), JSON.stringify(mk(null, false)));
