// Atom strings across calls (on by default; SCRIPTC_WASMGC_ATOM_STRINGS=0 turns them off): string parameters and results held as atom ids when every
// direct call passes a literal, an atom local or an atom result and every return is one (speedOf, nextOf, cycle, pace,
// settle); functions also reached as values (a closure, an array of functions, a JS helper calling with a string no
// literal spells) keep the string ABI, and so do parameters a call or a write feeds a non-atom.
import { callWith, built } from "./atom-string-params-helper.js";

type Mode = "idle" | "walk" | "run" | "swim";

function speed(m: Mode): number {
  if (m === "idle") return 0;
  if (m === "walk") return 2;
  if (m === "run") return 5;
  return 1;
}
function next(m: Mode): Mode { return m === "idle" ? "walk" : m === "walk" ? "run" : m === "run" ? "swim" : "idle"; }
function label(m: string): string { return m === "run" ? "fast" : m === "walk" ? "slow" : "other"; }

// Used as values as well as called directly: the string ABI.
let m: Mode = "idle";
const trail: string[] = [];
for (let i = 0; i < 6; i++) { trail.push(`${m}:${speed(m)}:${label(m)}`); m = next(m); }
console.log(trail.join(" "));
console.log(next(next("walk")) === "swim", next("swim") === "idle", label(next("idle")), speed(next(next("idle"))));

// Direct calls only (the atom ABI): results feeding parameters, recursion, a parameter reassigned inside.
function speedOf(m: Mode): number { return m === "idle" ? 0 : m === "walk" ? 2 : m === "run" ? 5 : 1; }
function nextOf(m: Mode): Mode { if (m === "idle") return "walk"; if (m === "walk") return "run"; if (m === "run") return "swim"; return "idle"; }
function labelOf(m: Mode, loud: boolean): string { const l = m === "run" ? "fast" : m === "walk" ? "slow" : "other"; return loud ? (l === "fast" ? "FAST" : "LOUD") : l; }
function cycle(m: Mode, n: number): Mode { return n === 0 ? m : cycle(nextOf(m), n - 1); }
function pace(m: Mode, k: number): Mode { let cur: Mode = m; while (k-- > 0) cur = nextOf(cur); return cur; }
function direct(): void {
  let am: Mode = "swim";
  const steps: string[] = [];
  for (let i = 0; i < 5; i++) { am = nextOf(am); steps.push(am + speedOf(am) + labelOf(am, i > 2)); }
  console.log(steps.join(" "), pace("idle", 6), pace(am, 1) === "swim", speedOf(cycle(am, 2)), labelOf(cycle("idle", 5), false));
  const pair: string[] = [];
  for (const x of [nextOf("run"), nextOf(am)]) pair.push(x);
  console.log(pair.join(","), labelOf(nextOf(nextOf(am)), true), tone("run", true), tone("walk", false), tone(nextOf("swim"), false));
}
// Closures and an array of closures calling with literals.
const fixed = [() => speedOf("run"), () => speedOf(nextOf("idle")), () => labelOf(cycle("walk", 3), false)];
console.log(fixed.map((f) => f()).join(","));
function tone(m: Mode = "idle", loud = false): string { return labelOf(m, loud) + (m === "idle" ? "." : "!"); }
direct();

// Recursion: the argument is an atom result.
console.log(cycle("idle", 0), cycle("idle", 3), cycle("run", 9), cycle(cycle("walk", 2), 2) === "walk");

// Default parameters, with and without the argument.
function greet(name: string = "friend", mark = "!"): string { return name === "friend" ? "hello" + mark : "hi " + name + mark; }
console.log(greet(), greet("ann"), greet("friend", "?"), greet(undefined, "."));

// A parameter reassigned inside, by literals only, and by a built string.
function settle(m: Mode, wet: boolean): string { if (wet) m = "swim"; if (m === "swim") m = "idle"; return m; }
function shout(s: string, loud: boolean): string { if (loud) s = s.toUpperCase(); return s === "RUN" ? "loud run" : s; }
console.log(settle("run", true), settle("walk", false), settle("swim", false), shout("run", true), shout("run", false));

// Used as values: a closure over the function, an array of functions, a JS helper passing a string no literal spells.
const viaClosure = (x: Mode) => label(x) + "/" + speed(x);
const table: ((x: Mode) => string)[] = [label, (x) => next(x), viaClosure];
console.log(table.map((f) => f("walk")).join(" "), table.map((f) => f("run")).join(" "));
console.log(callWith(label, built("ru", "n")), callWith(label, built("wa", "lk")), callWith(label, built("j", "og")));
console.log(callWith(next as (s: string) => string, built("id", "le")), callWith(speed as unknown as (s: string) => string, built("sw", "im")));

// A runtime-built string meets the string-ABI functions.
const typed = built("ru", "n") as Mode;
console.log(speed(typed), label(typed), next(typed), typed === "run", typed === nextOf("walk"));

// Atom results used as values: stored, concatenated, keyed, measured, compared with a runtime-built string.
const results = [nextOf("idle"), nextOf("run"), labelOf("walk", false), cycle("swim", 2)];
const counts: Record<string, number> = {};
for (const r of results) counts[r] = (counts[r] ?? 0) + 1;
const anyResult: any = nextOf("walk");
console.log(results.join(","), JSON.stringify(counts), nextOf("idle") === built("wa", "lk"), nextOf("idle").length, `${nextOf("swim")}!`, typeof anyResult, anyResult);

// An atom result passed to a function that keeps string parameters (a non-atom argument elsewhere).
function wrap(s: string): string { return "<" + s + ">"; }
console.log(wrap(nextOf("walk")), wrap(built("a", "b")), wrap(labelOf("run", true)), wrap(settle("walk", true)));

// An atom local and an atom parameter reassigned between dyn uses: each use sees the current text (a box made for the
// first value must not outlive the write).
function dynUses(p: Mode, n: number): string {
  let s = "a";
  const out: any[] = [];
  const o: Record<string, number> = { a: 1, b: 2, run: 3, swim: 4 };
  for (let i = 0; i < n; i++) {
    const v: any = s, w: any = p;
    out.push(v, w, o[s], o[p]);
    const keys = new Map<any, number>(); keys.set(s, i); keys.set(p, i); out.push([...keys.keys()].join("+"));
    s = s === "a" ? "b" : "a";
    p = p === "run" ? "swim" : "run";
  }
  return out.join(" ");
}
console.log(dynUses("run", 3));
