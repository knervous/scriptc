// `x!++`, `(x)++` and their prefix and decrement forms update `x` itself: a non-null assertion and parentheses have no
// runtime meaning, in statement and in value position, on locals, members and elements.
class Counter {
  hits: number | undefined = 0;
  slots: Array<number | undefined> = [1, 2, 3];
}

let total: number | undefined = 10;
total!++;
(total)++;
console.log(total);
const before = total!--;
console.log(before, total);
console.log(++(total!), total);

const counter = new Counter();
counter.hits!++;
(counter.hits)!++;
console.log(counter.hits);
const old = counter.hits!++;
console.log(old, counter.hits);
--counter.hits!;
console.log(counter.hits);

counter.slots[1]!++;
(counter.slots[2])!--;
console.log(counter.slots.join(","));
console.log(counter.slots[0]!++, counter.slots[0]);

const maybe: Counter | null = Math.random() < 2 ? counter : null;
maybe!.hits!++;
console.log(maybe!.hits);
