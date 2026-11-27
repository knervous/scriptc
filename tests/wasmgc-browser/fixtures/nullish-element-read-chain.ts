// `found ?? xs[0] ?? null` on a possibly empty array (quest-tracker's trackedQuest): an out-of-range element reads as
// JS's undefined, which the outer default must see, though the checker types the read as present.
interface Quest { questKey: string; step: number }
function tracked(active: Quest[], pinned: string | null): Quest | null {
  return active.find((q) => q.questKey === pinned) ?? active[0] ?? null;
}
const qs: Quest[] = [{ questKey: "a", step: 1 }, { questKey: "b", step: 2 }];
console.log(tracked([], null), tracked(qs, "b")?.questKey, tracked(qs, "z")?.questKey);
const ns: number[] = [];
console.log(ns[0] ?? -1, ns[3] || 7, ns.at(-1) ?? "none");
class Box { v = 1 }
const bs: Box[] = [];
const first: Box | null = bs[0] ?? null;
console.log(first, (bs[0] ?? new Box()).v, bs[0]?.v);
