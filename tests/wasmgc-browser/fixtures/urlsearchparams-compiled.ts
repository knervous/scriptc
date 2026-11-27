// @options: {"hostHandles": true}
// @native-only: the compiled class (the engine lane has the page URLSearchParams)
// URLSearchParams on the native host is a compiled class: parsing, serialisation and every method without a host call.
const out: string[] = [];
function show(label: string, ...v: string[]): void { out.push(label + " " + v.join(" | ")); }
function S(x: string | number | boolean | null): string { return String(x); }
function A(x: string[]): string { return JSON.stringify(x); }
function AA(x: string[][]): string { return JSON.stringify(x); }
const p = new URLSearchParams("?a=1&b=2&a=3&c=%20x+y&&=nameless&flag&eq=a=b&%E2%82%AC=%F0%9F%98%80");
show("parse", S(p.toString()), S(p.get("a")), A(p.getAll("a")), S(p.get("zz")), S(p.get("c")), S(p.get("")), S(p.get("flag")), S(p.get("eq")), S(p.get("€")), S(p.size));
show("bytes", S(new URLSearchParams("a=%FF%FE&b=%C3&c=%E2%82&d=%2B+%25&e=%").toString()), S(new URLSearchParams("x=%zz&y=%4").get("x")));
show("has", S(p.has("a")), S(p.has("a", "3")), S(p.has("a", "9")), S(p.has("nope")));
p.append("d", "é&=#?");
p.set("a", "9");
p.delete("b");
p.delete("c", "nomatch");
show("mutate", S(p.toString()), S(p.size));
p.delete("a", "9");
show("delete value", S(p.has("a")));
const s = new URLSearchParams("z=1&b=2&a=3&b=1&a=0&é=x&e=y&B=up");
s.sort();
show("sort", S(s.toString()));
const seen: string[] = [];
s.forEach((v, k, o) => { seen.push(k + "=" + v + (o === s ? "!" : "?")); });
show("forEach", A(seen));
show("entries", AA([...s]), A([...s.keys()]), A([...s.values()]), S([...s.entries()].length));
const loop: string[] = [];
for (const [k, v] of s) loop.push(k + v);
show("for-of", A(loop));
show("ctor record", S(new URLSearchParams({ x: "1", y: "a b", z: "é" }).toString()));
show("ctor pairs", S(new URLSearchParams([["m", "n"], ["o", "p q"]]).toString()));
show("ctor copy", S(new URLSearchParams(new URLSearchParams("a=1&a=2")).toString()));
const copy = new URLSearchParams(s); copy.append("copy", "1");
show("copy independent", S(s.has("copy")), S(copy.has("copy")));
show("ctor misc", S(new URLSearchParams().toString()), S(new URLSearchParams("").toString()), S(new URLSearchParams(undefined).size), S(new URLSearchParams("a").toString()), S(new URLSearchParams("a&b=").toString()));
show("encode", S(new URLSearchParams({ k: "a b+c&d=e%f*g-h.i_j~k!l(m)n'o", "key é": "😀 \uD83D x" }).toString()));
show("string", S(String(p)), S(`${s}`), S(p + ""), S(Object.prototype.toString.call(p)), S(typeof p));
show("instanceof", S(p instanceof URLSearchParams), S(({} as unknown) instanceof URLSearchParams), S(typeof URLSearchParams));
try { new URLSearchParams([["only"]]); show("bad pair", "no throw"); } catch (e) { show("bad pair", (e as Error).name); }
try { new URLSearchParams([["a", "b", "c"]] as unknown as string[][]); show("bad triple", "no throw"); } catch (e) { show("bad triple", (e as Error).name); }
const lp = new URLSearchParams("a=1&b=2&c=3");
const trace: string[] = [];
for (const [k] of lp) { trace.push(k); if (k === "a") lp.append("d", "4"); if (k === "b") lp.delete("a"); }
show("live for-of", A(trace), S(lp.toString()));
const liveKeys = lp.keys();
const first: any = liveKeys.next();
lp.append("late", "9");
const rest: string[] = [];
for (let r: any = liveKeys.next(); !r.done; r = liveKeys.next()) rest.push(r.value);
const after: any = liveKeys.next();
lp.append("again", "0");
const resumed: any = liveKeys.next();
show("live next", S(first.value), S(first.done), A(rest), S(after.done), S(after.value === undefined), S(resumed.done), S(resumed.value));
const vals = lp.values(); const ents = lp.entries();
show("iterator tags", Object.prototype.toString.call(vals), Object.prototype.toString.call(ents), S(typeof (ents as any).next));
const e0: any = ents.next();
// (isArray read first: the typed array view of the entry is a copy, fenced if e0 is read after it; owner's alias rule.)
const e0IsArray = Array.isArray(e0.value);
show("entry", A(e0.value), S(e0IsArray));
const big = new URLSearchParams();
for (let i = 0; i < 300; i++) big.append("k" + (i % 7), "v" + i);
show("big", S(big.size), S(big.getAll("k3").length), S(big.toString().length), S(big.get("k6")));
console.log(out.join("\n"));
