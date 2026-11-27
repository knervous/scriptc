// A `let` initialised to a non-zero value and used only through `s++` keeps its initial value.
function id(x: number): { done: boolean; v: number } { return { done: x > 3, v: x }; }
let r = id(0);
let s = 1;
const seen: number[] = [];
while (!r.done) { seen.push(r.v); r = id(s++); }
seen.push(r.v);
console.log(seen.join(" "));
function g(): string { let k = 5; const out: number[] = []; while (out.length < 3) out.push(k++); return out.join(","); }
console.log(g());
