// @options: {"hostHandles": true}
// A match result's groups is one null-prototype object, shared by typed and untyped code: identity, the prototype,
// and a write on either side are visible on the other.
const text = "user=bob id=7";
const m = /user=(?<user>\w+) id=(?<id>\d+)(?<opt>x)?/.exec(text)!;
const g = m.groups!;
const a: any = m;
console.log(g === a.groups, m.groups === m.groups, Object.getPrototypeOf(m.groups) === null, Object.getPrototypeOf(a.groups) === null);
console.log(m.groups!.user, m.groups!.id, m.groups!.opt, Object.keys(g).join(","));
// typed to untyped
m.groups!.user = "alice";
console.log(a.groups.user, g.user);
g.extra = "e";
console.log(a.groups.extra, Object.keys(a.groups).join(","));
// untyped to typed
a.groups.id = "99";
console.log(m.groups!.id, g.id);
a.groups.opt = "now";
console.log(m.groups!.opt);
// the object travels as itself
function bump(gr: RegExpMatchArray["groups"]): void { gr!.id = "100"; }
bump(m.groups);
console.log(a.groups.id, m.groups!.id);
const { groups } = m;
console.log(groups === g, groups!.user);
const { user, id } = m.groups!;
console.log(user, id);
// a plain String.match list and a pattern without names have no groups
console.log(text.match(/\w+/g)!.groups, /(\d)/.exec(text)!.groups, (a as any).groups !== undefined);
