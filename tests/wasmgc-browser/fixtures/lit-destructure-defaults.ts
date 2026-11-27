// Literal unions through destructuring (object, array, nested, rest), destructuring defaults,
// default parameters of literal type (including defaults that depend on earlier parameters),
// and getters returning literals.
type Mode = "easy" | "normal" | "hard";
interface Opts { mode?: Mode; label?: string; extra?: { mode: Mode } }

function setup({ mode = "normal", label = mode + "!" }: Opts = {}): string { return `${mode}/${label}`; }
console.log(setup(), setup({ mode: "hard" }), setup({ label: "x" }), setup({ mode: undefined }), setup({ mode: "easy", label: undefined }));

function chain(a: Mode = "easy", b: Mode = a === "easy" ? "normal" : "hard", c: string = a + b): string { return [a, b, c].join(","); }
console.log(chain(), chain("hard"), chain(undefined, "easy"), chain("normal", undefined, "z"));

const opts: Opts[] = [{ mode: "hard", extra: { mode: "easy" } }, {}, { extra: { mode: "normal" } }];
for (const { mode = "easy", extra: { mode: inner } = { mode: "hard" } } of opts) console.log(mode, inner, mode === inner);

const modes: Mode[] = ["hard", "easy", "normal", "easy"];
const [m0, , m2 = "hard", ...rest] = modes;
console.log(m0, m2, rest.join("+"), rest.length, m0 === "hard");
const [x1 = "normal", x2 = "easy"] = [] as Mode[];
console.log(x1, x2);

// Swap via destructuring.
let p: Mode = "easy", q: Mode = "hard";
[p, q] = [q, p];
console.log(p, q, p === "hard");

// Object rest keeps literal fields.
const full = { mode: "normal" as Mode, level: 3, tag: "t" as "t" | "u" };
const { level, ...without } = full;
console.log(level, JSON.stringify(without), without.mode === "normal", Object.keys(without).join(","));

// Getters and static getters returning literals.
class Settings {
  #raw = 2;
  static get defaultMode(): Mode { return "normal"; }
  get mode(): Mode { return this.#raw === 0 ? "easy" : this.#raw === 1 ? "normal" : "hard"; }
  set level(n: number) { this.#raw = n; }
}
const st = new Settings();
const seen: string[] = [st.mode];
st.level = 0; seen.push(st.mode);
st.level = 1; seen.push(st.mode);
console.log(seen.join(","), Settings.defaultMode, st.mode === Settings.defaultMode, JSON.stringify(st));
const { mode: fromGetter } = st;
console.log(fromGetter, fromGetter === "normal");

// Destructuring in a for-of over Map entries keyed by literals.
const weights = new Map<Mode, number>([["easy", 1], ["hard", 3]]);
for (const [k, v] of weights) console.log(k, v, k === "hard" ? "H" : "-");
