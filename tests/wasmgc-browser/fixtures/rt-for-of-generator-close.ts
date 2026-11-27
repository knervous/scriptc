// A for-of over a generator closes it on every early exit: break, return, a throw from the body, a labeled jump past
// the loop (10-30: only break closed). Exhaustion and a generator step that throws do not close it again.
const log: string[] = [];
function* g(tag: string): Generator<number, void, undefined> {
  try { yield 1; yield 2; } finally { log.push("close " + tag); }
}
for (const x of g("brk")) { if (x === 1) break; }
console.log("break", log.splice(0).join(","));
function ret(): number { for (const x of g("ret")) return x; return -1; }
console.log("return", ret(), log.splice(0).join(","));
try { for (const x of g("thr")) throw new Error("e" + x); } catch (e) { console.log("throw", (e as Error).message, log.splice(0).join(",")); }
outer: for (const r of [1, 2]) { for (const x of g("lbl" + r)) { if (x === 1) continue outer; } }
console.log("label", log.splice(0).join(","));
for (const x of g("done")) void x;
console.log("exhausted", log.splice(0).join(","));
function* bad(): Generator<number, void, undefined> {
  try { yield 1; throw new Error("step"); } finally { log.push("bad finally"); }
}
try { for (const x of bad()) void x; } catch (e) { console.log("step throw", (e as Error).message, log.splice(0).join(",")); }
function* outerGen(): Generator<number, void, undefined> { for (const x of g("inner")) yield x * 10; }
const it = outerGen();
console.log(it.next().value, it.return().done, log.splice(0).join(","));
let sum = 0;
for (const x of g("loop")) { if (x === 2) continue; sum += x; }
console.log("continue", sum, log.splice(0).join(","));
