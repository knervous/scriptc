// A nullable typed match result: narrowed by a test, by !, and held in a field or a parameter.
function at(m: RegExpExecArray | null): number { return m !== null ? m.index : -1; }
function bang(m: RegExpExecArray | null): string { return m!.input + m!.index; }
class Holder { last: RegExpMatchArray | null = null; }
const h = new Holder();
const re = /(\d+)/;
console.log(at(re.exec("ab 12")), at(re.exec("ab")), bang(re.exec("x7")));
h.last = "k9".match(re);
if (h.last) console.log(h.last.index, h.last.input, h.last[1]);
const maybe = "q5".match(re);
console.log(maybe!.index, maybe?.[1]);
let cur: RegExpExecArray | null = re.exec("a1b2");
const seen: number[] = [];
while (cur !== null) { seen.push(cur.index); cur = /(\d)/g.exec("zz"); }
console.log(seen.join(","));
