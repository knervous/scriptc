function* g(): Generator<number, string, void> {
  try {
    yield 1;
    yield 2;
  } catch (e) {
    console.log("caught", (e as Error).message);
    yield 99;
  } finally {
    console.log("finally");
  }
  return "end";
}
const a = g();
console.log(JSON.stringify(a.next()));
console.log(JSON.stringify(a.return("early")));
console.log(JSON.stringify(a.next()));
const b = g();
console.log(JSON.stringify(b.next()));
console.log(JSON.stringify(b.throw(new Error("boom"))));
console.log(JSON.stringify(b.next()));
console.log(JSON.stringify(b.next()));
const c = g();
console.log(JSON.stringify(c.return("unstarted")));
console.log(JSON.stringify(c.next()));
const d = g();
try { d.throw(new Error("first")); } catch (e) { console.log("thrown", (e as Error).message); }
console.log(JSON.stringify(d.next()));
function* h(): Generator<number, void, void> {
  try { yield 1; } finally { yield 2; }
}
const i = h();
i.next();
console.log(JSON.stringify(i.return()));
console.log(JSON.stringify(i.next()));
