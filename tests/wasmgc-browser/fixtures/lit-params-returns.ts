// Literal unions as parameters, return values, default parameters, optional parameters, generic
// `<T extends string>` parameters, and through higher-order functions.
type Dir = "north" | "east" | "south" | "west";

function turn(d: Dir, right: boolean = true): Dir {
  switch (d) {
    case "north": return right ? "east" : "west";
    case "east": return right ? "south" : "north";
    case "south": return right ? "west" : "east";
    case "west": return right ? "north" : "south";
  }
}

function opposite(d: Dir): Dir { return turn(turn(d)); }
function pick(flag: number): Dir { return flag > 0 ? "north" : flag < 0 ? "south" : "east"; }
function maybe(d?: Dir): string { return d === undefined ? "none" : d; }
function withDefault(d: Dir = "west", n = 1): string { let x = d; for (let i = 0; i < n; i++) x = turn(x); return x; }

let d: Dir = "north";
const seen: string[] = [];
for (let i = 0; i < 5; i++) { seen.push(d); d = turn(d); }
console.log(seen.join(" "));
console.log(turn("north", false), opposite("east"), opposite(opposite("west")));
console.log(pick(3), pick(-1), pick(0), pick(3) === "north", pick(0) === pick(0));
console.log(maybe(), maybe("south"), maybe(undefined));
console.log(withDefault(), withDefault(undefined, 2), withDefault("north", 3));

// Generic identity and generic comparison keep the exact string.
function same<T extends string>(x: T): T { return x; }
function eq<T extends string>(a: T, b: T): boolean { return a === b; }
function firstOf<T extends string>(xs: readonly T[]): T { return xs[0]; }
const g = same<Dir>("east");
console.log(g, eq<Dir>(g, "east"), eq<Dir>(g, "west"), firstOf(["west", "north"] as const), same("free text"));

// Functions passed as values with literal parameters and returns.
const apply = (f: (d: Dir) => Dir, x: Dir, times: number): Dir => { let r = x; for (let i = 0; i < times; i++) r = f(r); return r; };
console.log(apply(turn, "north", 7), apply(opposite, "south", 3), apply((x) => (x === "north" ? "west" : x), "north", 1));

// A function returning a literal or undefined, used with ??.
function find(code: number): Dir | undefined { return code === 1 ? "north" : code === 2 ? "south" : undefined; }
console.log(find(1) ?? "?", find(2) ?? "?", find(3) ?? "?");

// A returned literal used as a string immediately.
console.log(pick(1).toUpperCase(), pick(-1).length, pick(0).charCodeAt(0), `${pick(1)}-${turn(pick(1))}`);
