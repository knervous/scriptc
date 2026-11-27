interface Keyed { key: string }

class Stack<T> {
  private items: T[] = [];
  push(item: T): this { this.items.push(item); return this; }
  pop(): T | undefined { return this.items.pop(); }
  get size(): number { return this.items.length; }
}

function groupBy<T extends Keyed>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.key);
    if (group) group.push(item);
    else groups.set(item.key, [item]);
  }
  return groups;
}

function largest<T>(items: T[], score: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) { best = item; bestScore = s; }
  }
  return best;
}

const stack = new Stack<number>().push(1).push(2).push(3);
console.log("size", stack.size, "pop", stack.pop(), "size", stack.size);

const words = ["apple", "avocado", "banana", "blueberry", "cherry"].map((w) => ({ key: w[0], word: w }));
for (const [key, group] of groupBy(words)) console.log(key, group.map((g) => g.word).join(","));
console.log("longest", largest(words, (w) => w.word.length)?.word);
console.log("empty", largest<string>([], (s) => s.length));
