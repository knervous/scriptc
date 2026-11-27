export function run() {
  const out = [];
  function* counter(n) { try { for (let i = 0; i < n; i++) { const got = yield i; if (got !== undefined) out.push("got " + got); } return "end"; } finally { out.push("fin"); } }
  const o = { make: counter };
  // spread, for-of with early break (return runs the finally), next with sent values, return, throw
  out.push([...o.make(3)].join(","));
  for (const v of o.make(5)) { if (v === 1) break; }
  const it = o.make(4);
  const r1 = it.next(), r2 = it.next("a"), r3 = it.return("early"), r4 = it.next();
  out.push(JSON.stringify([r1, r2, r3, r4]));
  const t = o.make(4);
  t.next();
  try { t.throw(new Error("boom")); } catch (e) { out.push("caught " + e.message); }
  out.push(JSON.stringify(t.next()));
  const last = o.make(1);
  out.push(JSON.stringify([last.next(), last.next(), last.next()]));
  out.push(Object.prototype.toString.call(last));
  return out.join(" | ");
}
