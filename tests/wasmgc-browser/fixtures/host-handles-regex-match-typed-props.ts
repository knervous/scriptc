// @options: {"hostHandles": true}
// A typed exec/match result carries index, input and groups exactly (RegExpExecArray / RegExpMatchArray).
function describe(label: string, m: RegExpExecArray | null): void {
  if (m === null) { console.log(label, "null"); return; }
  console.log(label, m.length, m.index, m.input, m[0], m[1], m[2] === undefined ? "undef" : m[2]);
}
function takesMatch(m: RegExpMatchArray): string {
  return `${m.index}:${m.input!.length}:${m[0]}`;
}
const text = "ab 12-zed cd 7-x9";

// exec with numbered groups and a missing group
const re = /(\d+)-(x)?(\w+)/;
const a = re.exec(text);
if (a) console.log(a.index, a.input, a[1], a[2] === undefined, a[3], a.length);
describe("exec", re.exec(text));
describe("miss", /q(\d)/.exec(text));

// A stored result read later
const stored = /(\w+)@(\w+)/.exec("mail bob@host now");
const later = (): string => (stored ? `${stored.index} ${stored.input} ${stored[1]} ${stored[2]}` : "none");
console.log(later());

// Named groups, including one that did not participate
const n = /(?<num>\d+)-(?<opt>q)?(?<word>\w+)/.exec(text);
if (n && n.groups) {
  console.log(Object.keys(n.groups).join(","), n.groups.num, n.groups.opt, n.groups.word, n.groups.opt === undefined);
  console.log(n.index, n.input.length);
}
// No named groups: groups is undefined
const plain = re.exec(text);
console.log(plain ? plain.groups === undefined : "none");

// match without g carries index; match with g is a plain list
const b = text.match(/(\d+)-(\w)/);
if (b) console.log(b.index, b.input, b[1], b[2], b.groups === undefined);
const g = text.match(/\d+/g);
if (g) console.log(g.length, g.index, g.input, g.groups, g.join("|"));
if (b) console.log(takesMatch(b));
console.log(takesMatch(text.match(/zed/)!));

// Destructuring
const [whole, num, , word] = re.exec(text)!;
console.log(whole, num, word);
const { index, input } = re.exec(text)!;
console.log(index, input);

// Iteration and a loop of exec results
const all = /\d+/g;
const seen: number[] = [];
for (let r = all.exec(text); r !== null; r = all.exec(text)) seen.push(r.index);
console.log(seen.join(","));
for (const part of re.exec(text)!) console.log(part === undefined ? "u" : part);

// A copy is a plain array
const copy = re.exec(text)!.slice(1);
console.log(copy.length, (copy as RegExpMatchArray).index);

// Sticky exec keeps its own index
const sticky = /\d/y; sticky.lastIndex = 3;
const s1 = sticky.exec(text);
console.log(s1 ? s1.index : "null", sticky.lastIndex);
