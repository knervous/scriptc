// Literal unions mixed with other types: Mode | undefined, Mode | null, Mode | number,
// Mode | string, an `as const` object standing in for a string enum (Node's type stripping
// rejects `enum`), generics `<T extends string>`, and keyof-derived unions.
type Mode = "idle" | "walk" | "run";

function u(m: Mode | undefined): string { return m === undefined ? "undef" : m === "walk" ? "W" : m; }
function n(m: Mode | null): string { return m === null ? "null" : m !== "idle" ? m.toUpperCase() : "i"; }
function num(m: Mode | number): string {
  if (typeof m === "number") return "n" + (m + 1);
  if (m === "run") return "R";
  return m;
}
function wide(m: Mode | string): number { return m === "idle" ? 0 : m === "walk" ? 1 : m === "run" ? 2 : m.length * 10; }

const opt: (Mode | undefined)[] = ["idle", undefined, "walk", "run"];
console.log(opt.map(u).join(","), JSON.stringify(opt), opt.indexOf(undefined), opt.filter((x): boolean => x !== undefined).length);
const nul: (Mode | null)[] = [null, "run", "idle", null];
console.log(nul.map(n).join(","), JSON.stringify(nul), nul.filter((x): boolean => x === null).length);
const mixed: (Mode | number)[] = [0, "run", "walk", 41, "idle"];
console.log(mixed.map(num).join(","), mixed.map((x) => typeof x).join(","), JSON.stringify(mixed));
const anyStr: (Mode | string)[] = ["walk", "jog", "", "run", "idle!"];
console.log(anyStr.map(wide).join(","));

// Optional field and optional parameter, with ?? and ?.
interface Cfg { mode?: Mode; fallback: Mode; }
const cfgs: Cfg[] = [{ fallback: "idle" }, { mode: "run", fallback: "walk" }, { mode: undefined, fallback: "run" }];
console.log(cfgs.map((c) => c.mode ?? c.fallback).join(","), cfgs.map((c) => c.mode?.length ?? -1).join(","), JSON.stringify(cfgs));
let late: Mode | undefined;
console.log(late === undefined, late ?? "none");
late = "walk";
console.log(late, late === "walk", late?.toUpperCase());

// Enum-like as-const object.
const Speed = { Slow: "slow", Fast: "fast", Warp: "warp-9" } as const;
type Speed = (typeof Speed)[keyof typeof Speed];
function cost(s: Speed): number { switch (s) { case Speed.Slow: return 1; case Speed.Fast: return 3; case "warp-9": return 9; } }
const speeds: Speed[] = [Speed.Fast, "slow", Speed.Warp];
console.log(speeds.map(cost).join(","), speeds.join(","), Object.values(Speed).join(","), Object.keys(Speed).join(","), speeds[0] === Speed.Fast);

// Generic over literal unions.
function choose<T extends string>(xs: readonly T[], i: number): T { return xs[i % xs.length]; }
function countOf<T extends string>(xs: readonly T[], x: T): number { let k = 0; for (const y of xs) if (y === x) k++; return k; }
const modes = ["idle", "walk", "walk", "run"] as const;
console.log(choose(modes, 5), countOf(modes, "walk"), countOf<string>(modes, "wa" + "lk"), choose(speeds, 2));

// keyof-derived union.
const stats = { str: 5, dex: 7, int: 3 };
type Stat = keyof typeof stats;
const statOrder: Stat[] = ["int", "str", "dex"];
let best: Stat = "str";
for (const s of statOrder) if (stats[s] > stats[best]) best = s;
console.log(best, best === "dex", statOrder.map((s) => s + stats[s]).join(","));

// A union with boolean and a union narrowed by `in`.
type Flag = Mode | boolean;
const flags: Flag[] = [true, "run", false, "idle"];
console.log(flags.map((f) => (typeof f === "boolean" ? (f ? "T" : "F") : f === "run" ? "R" : f[0])).join(""));
