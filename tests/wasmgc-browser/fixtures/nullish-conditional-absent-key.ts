// A keyed read of an absent key inside a conditional that feeds `??` answers undefined, as the direct
// `table[k] ?? fallback` does: the client's `spaceForZoneKey` (`(k === undefined ? undefined : SPACES[k]) ?? "outdoor"`)
// threw "the record has no key" for a zone with no entry.
type Space = "crypt" | "cavern" | "outdoor";
const SPACES: Readonly<Record<string, Space>> = { a: "crypt", b: "cavern" };
const direct = (k: string): Space => SPACES[k] ?? "outdoor";
const viaTernary = (k: string | undefined): Space => (k === undefined ? undefined : SPACES[k]) ?? "outdoor";
console.log(direct("a"), direct("zzz"));
console.log(viaTernary("b"), viaTernary(undefined), viaTernary("zzz"));
const nums: Record<string, number> = { one: 1 };
const pick = (k: string, flip: boolean): number => (flip ? nums[k] : nums[k.toUpperCase()]) ?? -1;
console.log(pick("one", true), pick("one", false), pick("two", true));
