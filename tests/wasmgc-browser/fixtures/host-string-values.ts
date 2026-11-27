// @options: {"hostHandles": true}
// @native-only: host-owned page strings are the native host's; the engine host has JS strings
// Page strings under the native host are GC values of the host's own string type: they must behave as strings
// (typeof, ===, property reads and keys, Map and Set keys, string methods, template and concat), never as compiled values.
// The strings here come from the page itself (process.release.name, process.platform, Date text), read as untyped values.
const g: any = globalThis;
const a: any = g.process.release.name;
const p: any = g.process.platform;
const t: any = new Date(0).toISOString();
console.log(typeof a, a === "node", "node" === a, a === g.process.release.name, a !== p, a.length);
console.log(a.toUpperCase(), a + "!", `${a}-${typeof p}`, a.charAt(1), a.indexOf("d"), a.slice(1), a.startsWith("no"));
console.log(t.length, t.slice(0, 4), t.includes("T00"), t.padEnd(26, "*"), [...a].length);
const m = new Map<any, number>();
m.set(a, 1);
m.set(p, 2);
console.log(m.get("node"), m.get(g.process.platform), m.get("x"), m.size, m.has(a));
const s = new Set<any>([a, g.process.release.name, "node", p]);
console.log(s.size, s.has("node"), s.has(p));
const o: any = {};
o[a] = 5;
o[p] = 6;
console.log(o.node, o[g.process.release.name], o[g.process.platform], Object.keys(o).join());
const a2: any = g.process.release.name;
console.log(a === a2, Object.is(a, a2), [a].includes(a2), [a].indexOf(a2), a < "z", String(a));
console.log(a === "node" ? "tern ok" : "tern miss", a === 3, a === null, a === undefined, a === p);
const mixed: any[] = [a, 3, p, null, undefined, true, t];
console.log(mixed.map((v) => typeof v).join(), mixed.filter((v) => v === "node").length);
const keys = Object.keys(g.process.release);
console.log(keys.includes("name"), keys.indexOf("name") >= 0, keys.length > 0);
