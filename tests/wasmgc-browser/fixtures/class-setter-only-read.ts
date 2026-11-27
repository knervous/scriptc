// Reading an accessor that has only a setter answers undefined (JS), on a
// plain class, through typed and unknown-typed consumers.
class Plain {
  seen = "";
  set label(v: string) { this.seen = v; }
}
const p = new Plain();
p.label = "x";
const v: unknown = p.label;
const out: unknown[] = [v, typeof v, p.seen, p.label as unknown];
console.log(out.map((x) => (x === undefined ? "undef" : String(x))).join("|"));
