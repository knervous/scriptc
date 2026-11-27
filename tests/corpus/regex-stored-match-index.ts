// A match result stored and read later keeps its index and input (exec, match, matchAll rows), and a global
// String.match result has neither.
const subject = "GET /users/42?sort=desc";

function route(path: string): RegExpExecArray | null {
  return /\/users\/(\d+)/.exec(path);
}

const found = route(subject);
if (found) console.log("exec", found[1], found.index, found.input === subject);

const matched = subject.match(/sort=(\w+)/);
if (matched) console.log("match", matched[1], matched.index, matched.input?.length);

const rows: RegExpMatchArray[] = [];
for (const m of "a1 b22 c333".matchAll(/([a-z])(\d+)/g)) rows.push(m);
for (const m of rows) console.log("row", m[1], m[2], m.index, m.input);

const global = "x1 y2".match(/\d/g);
console.log("global", global?.join(","), global === null ? "null" : String((global as RegExpMatchArray).index));

function firstIndex(results: RegExpExecArray[]): number {
  return results.length === 0 ? -1 : results[0]!.index;
}
const all: RegExpExecArray[] = [];
const re = /o/g;
let r: RegExpExecArray | null;
while ((r = re.exec("foo boo")) !== null) all.push(r);
console.log("first", firstIndex(all), all.map((m) => m.index).join(" "));
