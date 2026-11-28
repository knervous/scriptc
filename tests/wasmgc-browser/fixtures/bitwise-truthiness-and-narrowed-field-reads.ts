// The truthiness of a bitwise result, Math.imul and an int32 local, tested without a float round trip; and a field read
// tested for null and then narrowed, read once. Both must keep JavaScript's answers, including the edges.

const flags = [0, 1, 2, 3, 6, -1, 0.5, 2.9, -2.5, 2 ** 31, 2 ** 32 + 2, -(2 ** 31), NaN, Infinity, -Infinity, 1e20];
const masks = [0, 1, 2, 0xffffffff, -1];
const row: string[] = [];
for (const f of flags) {
  for (const k of masks) {
    row.push(`${f & k ? 1 : 0}${f | k ? 1 : 0}${f ^ k ? 1 : 0}${f << k ? 1 : 0}${f >> k ? 1 : 0}${f >>> k ? 1 : 0}${Math.imul(f, k) ? 1 : 0}`);
  }
}
console.log(row.join(" "));

// `>>>` at or above 2^31 is truthy (its i32 bits are negative, not zero); `!` and `while` take the same test.
let n = 0;
let bits = -8 >>> 0;
while (bits & 0xf0000000) {
  bits = bits << 4;
  n++;
}
console.log(n, !(-1 >>> 0), !(0 >>> 0), !((1 << 31) >>> 0));

// An int32 local (written only with bitwise results).
let acc = 0;
let truthy = 0;
for (let i = 0; i < 40; i++) {
  acc = (acc << 1) ^ i;
  if (acc) truthy++;
}
console.log(truthy, acc);

class Item {
  next: Item | null = null;
  back: Item | null = null;
  readonly id: number;
  constructor(id: number) {
    this.id = id;
  }
}

const first = new Item(1);
first.next = new Item(2);
first.next.next = new Item(3);

function walk(start: Item): string {
  const seen: number[] = [];
  let node: Item = start;
  while (true) {
    seen.push(node.id);
    if (node.next === null) break;
    node.next.back = node;
    node = node.next;
  }
  return `${seen.join(",")} back ${node.back === null ? "none" : node.back.id}`;
}
console.log(walk(first));

// The narrowing still throws when the value is null: a non-null assertion the program got wrong.
function lastNext(item: Item): number {
  const next = item.next!;
  return next.id;
}
try {
  console.log(lastNext(first));
  console.log(lastNext(first.next.next));
} catch (e) {
  console.log(e instanceof TypeError ? "TypeError" : String(e));
}
