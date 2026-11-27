// @native-only: a class constructed through a class value (engine dyn has no class values)
// Atom constructor parameters (on by default; SCRIPTC_WASMGC_ATOM_STRINGS=0 turns them off): a constructor whose every `new` and super call passes a
// literal, an atom local or an atom result takes the atom (no interning per `new`); a class constructed through a class
// value, or whose ancestor is one, keeps the string ABI and meets run-time strings.
type Kind = "melee" | "ranged" | "spell";

class Attack {
  readonly kind: Kind;
  readonly power: number;
  label: string;
  constructor(kind: Kind, power: number, label: string = "plain") {
    this.kind = kind;
    this.power = power;
    this.label = kind === "spell" ? "magic" : label;
  }
  score(): number { return this.kind === "melee" ? this.power * 2 : this.kind === "ranged" ? this.power + 3 : this.power * 3; }
}
class Charged extends Attack {
  charge: string;
  constructor(kind: Kind, charge: string) { super(kind, 4, charge === "full" ? "charged" : "half"); this.charge = charge; }
}
function pick(i: number): Kind { return i % 3 === 0 ? "melee" : i % 3 === 1 ? "ranged" : "spell"; }

function build(): void {
  const list: Attack[] = [];
  let k: Kind = "melee";
  for (let i = 0; i < 6; i++) {
    list.push(new Attack(k, i, "plain"), new Attack(pick(i), i + 1, "x"), new Charged(pick(i + 1), i & 1 ? "full" : "low"));
    k = k === "melee" ? "spell" : "melee";
  }
  console.log(list.map((a) => `${a.kind}/${a.label}/${a.score()}`).join(" "));
  console.log(list.filter((a) => a.kind === "spell").length, list.filter((a) => a.label === "charged").length);
}
build();

// A class constructed through a class value, with a run-time string.
class Token {
  text: string;
  n: number;
  constructor(text: string, n: number) { this.text = text; this.n = n; }
  is(t: string): boolean { return this.text === t; }
}
class Word extends Token {}
const ctors: (typeof Token)[] = [Token, Word];
const built = ["sp", "ell"].join("");
const tokens = ctors.map((C, i) => new C(i ? built : "melee", i));
tokens.push(new Token("melee", 9), new Word("ranged", 8));
console.log(tokens.map((t) => `${t.text}:${t.n}:${t.is("melee")}:${t.is(built)}`).join(" "));
