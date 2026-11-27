// Literal unions in closures' captured bindings: a let captured and reassigned by several
// closures, closures created in a loop each capturing its own literal, a closure returned from a
// factory with a literal parameter, and arrow functions returning literals.
type Light = "red" | "amber" | "green";

let light: Light = "red";
const advance = () => { light = light === "red" ? "green" : light === "green" ? "amber" : "red"; return light; };
const peek = (): Light => light;
const isStop = () => light === "red";
const seq: string[] = [];
for (let i = 0; i < 7; i++) seq.push(advance() + (isStop() ? "!" : ""));
console.log(seq.join(" "), peek());

// Factory capturing its literal parameter.
function makeCheck(target: Light): (l: Light) => boolean { return (l) => l === target; }
const isRed = makeCheck("red"), isAmber = makeCheck("amber"), isGreen = makeCheck("green");
console.log(isRed("amber"), isAmber("amber"), isGreen("amber"), isRed(peek()), isAmber(peek()), isGreen(peek()));

// Loop closures each capturing a different literal.
// (arrays of functions have no array representation yet: each closure is held by an object)
class Thunk { f: () => Light; constructor(f: () => Light) { this.f = f; } }
const fns: Thunk[] = [];
const all: Light[] = ["green", "red", "amber"];
for (const l of all) fns.push(new Thunk(() => l));
console.log(fns.map((t) => t.f()).join(","), fns[1].f() === "red", fns.map((t) => t.f().length).join(""));

// A counter object whose methods close over a literal state.
function machine() {
  let state: "off" | "on" | "broken" = "off";
  let flips = 0;
  return {
    flip() { if (state === "broken") return state; state = state === "off" ? "on" : "off"; if (++flips > 4) state = "broken"; return state; },
    get state() { return state; },
    reset() { state = "off"; flips = 0; },
  };
}
const m = machine();
const out: string[] = [];
for (let i = 0; i < 7; i++) out.push(m.flip());
console.log(out.join(","), m.state);
m.reset();
console.log(m.state, m.flip(), m.state === "on");

// A captured literal used as a key and compared in a nested closure.
const tally = new Map<Light, number>();
const bump = (l: Light) => (): void => { tally.set(l, (tally.get(l) ?? 0) + 1); };
class Bumper { f: () => void; constructor(f: () => void) { this.f = f; } }
const bumpers = all.map((l) => new Bumper(bump(l)));
for (let i = 0; i < 10; i++) bumpers[i % 3].f();
console.log([...tally].map(([k, v]) => k + v).join(","));

// Closure capturing a const literal narrowed by a type guard.
function isLight(s: string): s is Light { return s === "red" || s === "amber" || s === "green"; }
const inputs = ["green", "blue", "amb" + "er"];
const guarded = inputs.filter(isLight).map((l) => new Thunk(() => (l === "green" ? "amber" : l)));
console.log(guarded.map((g) => g.f()).join(","));

// Immediately-invoked closure and a recursive closure over a literal.
const res = ((l: Light): string => (l === "amber" ? "caution" : "other"))("amber");
const countdown = (l: Light, n: number): string => (n === 0 ? l : countdown(l === "red" ? "green" : "red", n - 1));
console.log(res, countdown("red", 5), countdown("amber", 2));
