// What a compiled Map/Set refuses (explicitly) in the native lanes.
function M(src) { return src === undefined ? new Map() : new Map(src); }
function caught(f) { try { return "ok " + String(f()); } catch (e) { return e.name + ": " + e.message; } }
export function refusals() {
  const m = M([["a", 1], ["b", 2]]), seen = [];
  return [
    caught(() => { m.forEach((v, k) => { seen.push(k + JSON.stringify(m)); }); return seen.join(","); }),
    caught(() => { m.set("c", 3); return [...m].length + m.size; }),
  ].join("\n");
}
