// Literal unions in class fields: instance (initialized and constructor-assigned), static,
// private #fields, inherited and overridden-by-assignment fields, getters/setters returning
// literals, a discriminant switched on, and spread/JSON/Object.keys of instances.
type State = "closed" | "opening" | "open" | "closing";
type Kind = "door" | "gate" | "hatch";

class Portal {
  static defaultState: State = "closed";
  static kinds: Kind[] = ["door", "gate", "hatch"];
  state: State = Portal.defaultState;
  #lock: "locked" | "unlocked" = "locked";
  kind: Kind;
  constructor(kind: Kind) { this.kind = kind; }
  get locked(): "yes" | "no" { return this.#lock === "locked" ? "yes" : "no"; }
  get lockWord(): string { return this.#lock; }
  set lockWord(v: string) { this.#lock = v === "unlocked" ? "unlocked" : "locked"; }
  unlock(): void { this.#lock = "unlocked"; }
  step(): State {
    switch (this.state) {
      case "closed": if (this.#lock === "unlocked") this.state = "opening"; break;
      case "opening": this.state = "open"; break;
      case "open": this.state = "closing"; break;
      case "closing": this.state = "closed"; break;
    }
    return this.state;
  }
  describe(): string { return `${this.kind}:${this.state}:${this.#lock}`; }
}

class Gate extends Portal {
  material: "iron" | "wood" = "iron";
  constructor() { super("gate"); this.state = "open"; }
  describe(): string { return super.describe() + ":" + this.material; }
}

const p = new Portal("door");
const trace: string[] = [p.step()];
p.unlock();
for (let i = 0; i < 5; i++) trace.push(p.step());
console.log(trace.join(" "), p.locked, p.lockWord);
p.lockWord = "anything";
console.log(p.locked, p.lockWord, p.describe());

const g = new Gate();
console.log(g.describe(), g.kind === "gate", g.state === "open", g instanceof Portal, g.locked);
g.material = "wood";
g.unlock();
console.log(g.step(), g.step(), g.step(), g.describe());

Portal.defaultState = "open";
const q = new Portal("hatch");
console.log(q.state, Portal.defaultState, Portal.kinds.join("|"), Portal.kinds.indexOf(q.kind));

// (Entries of the spread-and-override copy are sorted: see lit-defect-spread-override-order.)
// Instances seen through generic operations: own enumerable fields only (private ones hidden).
console.log(JSON.stringify(g), Object.keys(q).join(","), JSON.stringify({ ...q }));
const copy = { ...g, state: "closing" as State };
console.log(copy.kind, copy.state, copy.material, Object.entries(copy).map(([k, v]) => k + "=" + v).sort().join(";"));

// Fields of many instances compared to each other and counted.
const all: Portal[] = [];
for (let i = 0; i < 12; i++) { const x = new Portal(Portal.kinds[i % 3]); if (i % 2) x.unlock(); for (let j = 0; j < i; j++) x.step(); all.push(x); }
// Written in sorted key order: see lit-defect-record-literal-order.
const tally: Record<State, number> = { closed: 0, closing: 0, open: 0, opening: 0 };
for (const x of all) tally[x.state] = tally[x.state] + 1;
console.log(JSON.stringify(tally), all.filter((x) => x.kind === all[0].kind).length, all.filter((x) => x.state === all[3].state).length);

// A field assigned a runtime-built string that is a member.
const r = new Portal("door");
r.state = ("op" + "en") as State;
console.log(r.state === "open", r.step(), r.state);

// Abstract-ish base with a field narrowed by subclasses.
abstract class Shape { abstract get tag(): "circle" | "square"; area(): number { return this.tag === "circle" ? 3 : 4; } }
class Circle extends Shape { get tag() { return "circle" as const; } }
class Square extends Shape { get tag() { return "square" as const; } }
const shapes: Shape[] = [new Circle(), new Square(), new Circle()];
console.log(shapes.map((s) => s.tag + s.area()).join(","));
