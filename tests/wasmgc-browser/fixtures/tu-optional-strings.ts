// `string | undefined` and `string | null` are held as the string itself
// (the null reference is the unit): the empty string stays falsy and
// distinct from null/undefined, equality compares contents, and values
// cross to untyped code and back exactly.
type User = { name: string; nick?: string; title: string | null };
const users: User[] = [
  { name: "ada", nick: "a", title: null },
  { name: "bob", title: "dr" },
  { name: "cy", nick: "", title: "" },
];
const kind = (s: string | null | undefined): string => s === undefined ? "undef" : s === null ? "null" : s === "" ? "empty" : "str:" + s;
console.log(users.map(u => kind(u.nick)).join(","), users.map(u => kind(u.title)).join(","));
console.log(users.map(u => (u.nick ? "t" : "f") + (u.title ? "t" : "f")).join(" "), users.map(u => u.nick ?? "-").join(","), users.map(u => u.title ?? "-").join(","));
console.log(users.map(u => u.nick?.length ?? -1).join(","), users.map(u => u.title?.toUpperCase()).join(","), users.map(u => String(typeof u.nick === "string") + "/" + String(typeof u.title === "object")).join(","));
let last: string | undefined;
for (const u of users) if (u.nick !== undefined) last = u.nick;
console.log(JSON.stringify(last), last === "", last == null);
const a: string | null = ["x", "y"].join(""), b: string | null = "x" + "y", c: string | null = null;
console.log(a === b, a !== c, c === null, Object.is(a, b), a === ("xy" as string | null));
const opts: (string | undefined)[] = ["p", undefined, "q", ""];
console.log(opts.indexOf("q"), opts.indexOf(undefined), opts.includes(""), opts.lastIndexOf("p"), opts.join("|"));
const names = new Map<string, string | null>([["k", "v"], ["n", null]]);
const g1 = names.get("k"), g2 = names.get("n"), g3 = names.get("z");
console.log(kind(g1), kind(g2), kind(g3), g2 === null, g3 === undefined);
console.log(JSON.stringify(users), String(users[1]!.nick), `${users[0]!.title}`);
const anyNick: any = users[0]!.nick, anyTitle: any = users[0]!.title, anyMissing: any = users[1]!.nick;
console.log(anyNick, anyTitle === null, anyMissing === undefined, typeof anyMissing === "undefined");
const back1 = anyNick as string | null, back2 = anyTitle as string | null;
console.log(back1, back2 === null, kind(back1), kind(back2));
function pick(i: number): string | undefined { return i === 0 ? undefined : i === 1 ? "" : "s" + i; }
let total = "";
for (let i = 0; i < 4; i++) { const p = pick(i); total += p === undefined ? "U" : p.length ? p : "E"; }
console.log(total, pick(1) === pick(1), pick(2) === pick(2), pick(0) === pick(0));
