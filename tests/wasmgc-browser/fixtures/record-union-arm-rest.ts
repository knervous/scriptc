// @options: {"interfaceClassArms": true}
// Destructuring with a rest element from an interface slot that holds record arms (a literal that sets
// optional fields beside one that leaves them out): the rest is a fresh record of the unconsumed fields,
// the consumed one is not carried into it.
const Kind = { A: 0, B: 1, C: 2 } as const;
interface Btn { type: number; action?: number; label?: string; color?: string; index?: number; data?: string[] }
interface HotData { hotButton: boolean; hotButtonIndex: number }
type Rec = Record<number, Btn>;
interface Cfg { name: string; hot: Rec; other: Rec }
const DEFAULT: Cfg = {
  name: "d",
  hot: {
    0: { type: Kind.A, action: 1, label: "Melee", index: 0 },
    "1": { type: Kind.B, label: "Tech", index: 1 },
    3: { type: Kind.C, label: "Hail", color: "#0f0", data: ["/hail"] },
  },
  other: {},
};
class Store {
  config: Cfg = DEFAULT;
  setBtn(i: number, b: Btn | null) {
    if (b) this.config.hot[i] = b;
  }
  setFull(i: number, b: Btn & HotData) { this.config.hot[i] = b; }
  pin(i: number, id: string, label: string) {
    const current = this.config.hot[i];
    if (!current) return;
    const { index: _p, ...rest } = current;
    this.config.hot[i] = { ...rest, label, data: [id] };
  }
  dump() { return JSON.stringify(this.config); }
}
const s = new Store();
s.setFull(5, { type: Kind.A, label: "full", hotButton: true, hotButtonIndex: 2 });
s.setBtn(6, { type: Kind.B });
s.pin(1, "kick", "Kick");
console.log(s.dump());
const back = JSON.parse(s.dump()) as Cfg;
console.log(back.hot[1].label, back.hot[1].index, back.hot[5].label);
function strip(b: Btn): Btn {
  const { index: _i, ...rest } = b;
  return rest;
}
const kept = strip({ type: 2, label: "k", index: 4 });
const plain = strip({ type: 3 });
console.log(JSON.stringify(kept), JSON.stringify(plain), kept.index);
