// A pure index-signature record that is also an arm of a union of records (whose arms carry a hidden shape word
// after the reference count) converts to an unknown value with its own keys and values: the conversion reads the
// record's overflow map past that word (a native program's config records reaching the page as unknown).
type Counts = { [name: string]: number };
type Named = { name: string; size: number };
type Entry = Counts | Named;

function entries(n: number): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      const c: Counts = {};
      c[`k${i}`] = i;
      c.extra = i * 10;
      out.push(c);
    } else out.push({ name: `n${i}`, size: i });
  }
  return out;
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

function counts(n: number): Counts {
  const c: Counts = {};
  for (let i = 0; i < n; i++) c[`c${i}`] = i * i;
  return c;
}

for (const e of entries(4)) console.log(show(e));
const c = counts(3);
const pick: Entry = c;
console.log(show(pick), show(c), Object.keys(c).join(","));
