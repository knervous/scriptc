// Type lies: arbitrary strings asserted `as Mode`, including non-members ("sprint", "", "WALK"),
// must keep their exact string through locals, parameters, returns, fields, arrays, maps, switch
// defaults and output. No comparison against a member literal may match a non-member.
type Mode = "idle" | "walk" | "run";

function lie(s: string): Mode { return s as Mode; }
function nameOf(m: Mode): string {
  switch (m) {
    case "idle": return "IDLE";
    case "walk": return "WALK";
    case "run": return "RUN";
    default: return "other(" + m + ")";
  }
}
function chain(m: Mode): string { return m === "idle" ? "i" : m === "walk" ? "w" : m === "run" ? "r" : "?"; }

const raw = ["sprint", "", "WALK", "walk", "run ", "idle", "é", "0"];
const lies: Mode[] = raw.map(lie);
console.log(lies.map(nameOf).join(" "));
console.log(lies.map(chain).join(""));
console.log(lies.map((m) => m.length).join(","), lies.map((m) => JSON.stringify(m)).join(","));

// Non-member flows through a field, a closure capture, and back out.
class Box { mode: Mode = "idle"; }
const b = new Box();
b.mode = lie("sprint");
let captured: Mode = lie("crawl");
const read = () => captured;
console.log(b.mode, b.mode === "idle", b.mode !== "run", read(), read() === lie("crawl"), read() === b.mode);
captured = "walk";
console.log(read(), read() === "walk");
captured = b.mode;
console.log(read(), read() === "sprint" as string, JSON.stringify(b), JSON.stringify({ m: read() }));

// Non-member and member as map keys and set members.
const m = new Map<Mode, number>();
for (const x of lies) m.set(x, (m.get(x) ?? 0) + 1);
console.log([...m.keys()].map((k) => `[${k}]`).join(""), m.get(lie("sprint")), m.get("walk"), m.has(lie("")), m.has(lie("sprint ")));
const s = new Set<Mode>(["idle", lie("idle"), lie("id" + "le"), lie("Idle")]);
console.log(s.size, [...s].join(","));

// Includes/indexOf on member arrays with non-members.
const members: Mode[] = ["idle", "walk", "run"];
console.log(lies.map((x) => members.includes(x)).join(","), lies.map((x) => members.indexOf(x)).join(","));

// Comparisons between two lies and between a lie and a plain string.
const a = lie("sp" + "rint");
const plain: string = "sprint";
console.log(a === lies[0], a == lies[0], a === plain, Object.is(a, lies[0]), a < lies[2], a > lies[1]);

// A record field holding a non-member, spread and stringified.
const rec: { mode: Mode; n: number } = { mode: lie("fly"), n: 1 };
const copy = { ...rec, n: 2 };
console.log(copy.mode, copy.mode === rec.mode, chain(copy.mode), JSON.stringify(copy), Object.values(copy).join("|"));

// A non-member returned through a generic and through a ternary that picks between lie and literal.
const id = <T extends string>(x: T): T => x;
for (let i = 0; i < 3; i++) {
  const v: Mode = i === 0 ? "run" : i === 1 ? lie("jog") : id<Mode>(lie("run"));
  console.log(i, v, chain(v), v === "run");
}
