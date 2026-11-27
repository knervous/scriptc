// Library-shaped constructors (not React's): an int32-initialized property
// the program later stores a fraction or null under, a constructor whose
// objects mostly take expandos (its struct allocation stops once demotions
// are a learned share of its allocations), and wide objects (more than 32
// properties, below the dictionary limit) built key by key.
function Timer(ms) { this.ms = ms; this.handle = 0; this.ticks = 0; }
function Bag(n) { this.n = n; this.size = 0; }
export function run() {
  var out = [], i, t, b, w, total = 0;
  for (i = 0; i < 300; i++) {
    t = new Timer(i);
    t.ticks = i % 3 === 0 ? 0.5 : i;
    if (i % 5 === 0) t.handle = null;
    total += (t.handle === null ? 1 : 0) + t.ticks;
  }
  out.push(total, JSON.stringify(new Timer(7)));
  for (i = 0; i < 400; i++) {
    b = new Bag(i);
    b["extra" + (i % 3)] = i;
    total += Object.keys(b).length;
  }
  out.push(total, Object.keys(new Bag(1)).join(","));
  for (i = 0; i < 50; i++) {
    w = {};
    for (var k = 0; k < 40 + (i % 10); k++) w["p" + k] = k;
    total += Object.keys(w).length + w.p39;
  }
  out.push(total);
  return out.join("|");
}
