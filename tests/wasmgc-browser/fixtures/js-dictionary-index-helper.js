// Dictionary objects (helper for js-dictionary-index.ts).
export function run() {
  const keyOf = (i) => (i % 5 === 0 ? "k" : "key_") + ((i * 37) % 997).toString(36) + (i % 7);
  const d = JSON.parse("{}");
  for (let i = 0; i < 300; i++) d[keyOf(i)] = i;
  let sum = 0, misses = 0;
  for (let i = 0; i < 600; i++) { const v = d[keyOf(i)]; if (v === undefined) misses++; else sum += v; }
  console.log(Object.keys(d).length, sum, misses, d[keyOf(17)], "key_x" in d, keyOf(3) in d, Object.prototype.hasOwnProperty.call(d, keyOf(299)));
  // Deletes move later keys down; re-added keys go to the end.
  for (let i = 0; i < 300; i += 3) delete d[keyOf(i)];
  console.log(Object.keys(d).length, Object.keys(d).slice(0, 6).join(","), d[keyOf(3)], d[keyOf(4)], keyOf(3) in d);
  for (let i = 0; i < 300; i += 6) d[keyOf(i)] = -i;
  const ks = Object.keys(d);
  console.log(ks.length, ks.slice(-4).join(","), d[keyOf(6)], d[keyOf(9)]);
  let order = ""; for (const k in d) if (d[k] === 17 || d[k] === -12) order += k + "=" + d[k] + ";";
  console.log(order);
  // A small dictionary made by one delete, then grown past the index threshold and shrunk again.
  const s = JSON.parse('{"a":1,"b":2,"c":3}');
  delete s.b;
  for (let i = 0; i < 20; i++) s["n" + i] = i;
  for (let i = 0; i < 20; i += 2) delete s["n" + i];
  console.log(Object.keys(s).join(","), s.a, s.b, s.n3, s.n4, "n5" in s, "n6" in s);
  // Attributes on a dictionary property; numeric-looking keys stay in index order first.
  Object.defineProperty(d, keyOf(1), { value: 99, writable: false, enumerable: false, configurable: true });
  try { d[keyOf(1)] = 5; } catch (e) { console.log("read-only", e instanceof TypeError); }
  d["10"] = "ten"; d["2"] = "two";
  console.log(d[keyOf(1)], Object.keys(d).includes(keyOf(1)), Object.keys(d).slice(0, 2).join(","), d["2"]);
  // A dictionary as a prototype.
  const child = JSON.parse('{"own":1}');
  Object.setPrototypeOf(child, d);
  console.log(child[keyOf(7)], child.own, keyOf(7) in child, Object.prototype.hasOwnProperty.call(child, keyOf(7)), child.nothing);
  // Word counting with computed keys.
  const text = "the quick brown fox jumps over the lazy dog the end".split(" ");
  const counts = JSON.parse("{}");
  for (let r = 0; r < 20; r++) for (const w of text) counts[w + (r % 13)] = (counts[w + (r % 13)] ?? 0) + 1;
  console.log(Object.keys(counts).length, counts.the0, counts.dog12, counts.fox5, JSON.stringify(counts).length);
  // Random sets, deletes and reads against a Map (same insertion order), on
  // an indexed dictionary: every answer and the final key order agree.
  const r = JSON.parse("{}"), ref = new Map();
  let x = 12345, bad = 0, ops = 0;
  for (let i = 0; i < 4000; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const key = "r" + ((x >>> 0) % 211), op = (x >>> 8) % 4;
    if (op === 0) { delete r[key]; ref.delete(key); }
    else if (op === 1) { r[key] = i; ref.set(key, i); }
    else { ops++; const want = ref.has(key) ? ref.get(key) : undefined; if (r[key] !== want || (key in r) !== ref.has(key)) bad++; }
  }
  console.log(ops, bad, Object.keys(r).join(",") === [...ref.keys()].join(","), Object.keys(r).length, ref.size);
}
