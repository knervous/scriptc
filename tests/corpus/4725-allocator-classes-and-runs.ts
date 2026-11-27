// Blocks of every size the runtime's allocator serves, made and dropped in
// turn: the small classes (up to 512 bytes), the large classes (up to 2 MiB)
// and runs of whole chunks beyond, as strings, arrays, records and maps. A
// recycled block must read as fresh, a block that grows (array storage,
// string building) must keep its contents across classes, and memory freed
// in one phase must serve the next. On Windows the allocator commits its
// reservation as it carves, so the runs and the large classes also cross the
// points where it commits more.

function checksum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 97) h = (h * 31 + s.charCodeAt(i)) % 1000000007;
  return h;
}

// Strings from 1 character to 6 MiB, built by doubling: each step reallocates
// through larger classes, then the large classes, then runs.
function growStrings(): void {
  let s = "ab";
  const seen: number[] = [];
  while (s.length < 6 * 1024 * 1024) {
    s = s + s.slice(0, s.length >> 1) + String.fromCharCode(97 + (s.length % 26));
    seen.push(s.length);
  }
  console.log("strings", seen.length, s.length, checksum(s));
}

// Arrays of every length up to 300 and a few far larger, filled by push (the
// storage grows in place or moves), read back, then dropped; a second pass
// gets recycled blocks and must see only its own elements.
function arrays(): void {
  let total = 0;
  for (let pass = 0; pass < 2; pass++) {
    const keep: number[][] = [];
    for (let n = 1; n <= 300; n++) {
      const a: number[] = [];
      for (let k = 0; k < n; k++) a.push(k * (pass + 1));
      keep.push(a);
    }
    for (const n of [40000, 300000, 700000]) {
      const a: number[] = [];
      for (let k = 0; k < n; k++) a.push(k & 1023);
      keep.push(a);
    }
    for (const a of keep) total += a.length + a[a.length - 1]! + a[a.length >> 1]!;
  }
  console.log("arrays", total);
}

// Records of 1 to 24 fields made by the thousand: each size is its own class.
function records(): void {
  let sum = 0;
  for (let round = 0; round < 3; round++) {
    const live: Record<string, number>[] = [];
    for (let i = 0; i < 4000; i++) {
      const o: Record<string, number> = {};
      const fields = 1 + (i % 24);
      for (let f = 0; f < fields; f++) o["f" + f] = i + f;
      live.push(o);
    }
    for (let i = 0; i < live.length; i += 13) {
      const o = live[i]!;
      sum += Object.keys(o).length + o["f0"]!;
    }
  }
  console.log("records", sum);
}

// Maps that grow past several table sizes and are cleared, three times.
function maps(): void {
  const out: number[] = [];
  for (let round = 0; round < 3; round++) {
    const m = new Map<string, number[]>();
    for (let i = 0; i < 30000; i++) m.set("k" + i, [i, round]);
    let s = 0;
    for (let i = 0; i < 30000; i += 101) s += m.get("k" + i)![0]!;
    out.push(m.size, s);
    m.clear();
  }
  console.log("maps", out.join(" "));
}

// Typed arrays above and below the largest small class, zeroed when made.
function typed(): void {
  let zeros = 0, sum = 0;
  for (let round = 0; round < 2; round++) {
    for (const n of [7, 64, 65, 128, 1000, 70000, 600000]) {
      const a = new Float64Array(n);
      for (let k = 0; k < n; k++) if (a[k] === 0) zeros++;
      for (let k = 0; k < n; k += 3) a[k] = k;
      sum += a[n - 1]! + a[0]!;
    }
  }
  console.log("typed", zeros, sum);
}

growStrings();
arrays();
records();
maps();
typed();
