// `o.f!` over a field holding `number | null` or `number | undefined`, read where it holds a number: the number itself
// (React's host context stack: `contextStackCursor.current!`), through a class field and a record field alike.

class Cursor {
  current: number | null = null;
  depth: number | undefined = undefined;
}

type Slot = { current: number | null; spare: number | undefined };

const stack: number[] = [];
const cursor = new Cursor();
const slot: Slot = { current: null, spare: undefined };

function push(value: number): void {
  if (cursor.current !== null) stack.push(cursor.current);
  cursor.current = value;
  cursor.depth = stack.length;
  slot.current = value * 2;
  slot.spare = value - 0.5;
}

function top(): number {
  return cursor.current!;
}

function depth(): number {
  return cursor.depth!;
}

let sum = 0;
const seen: string[] = [];
for (let i = 1; i <= 5; i++) {
  push(i === 3 ? -0 : i * 1.5);
  sum += top() + depth() + slot.current! + slot.spare!;
  seen.push(`${Object.is(top(), -0) ? "-0" : top()}/${depth()}/${slot.current!}/${slot.spare!}`);
}
console.log(seen.join(" "), sum);

// The unit values, read without narrowing.
const empty = new Cursor();
const blank: Slot = { current: null, spare: undefined };
console.log(empty.current, empty.depth, blank.current, blank.spare, empty.current === null, blank.spare === undefined);
cursor.current = NaN;
console.log(top(), Number.isNaN(cursor.current!));
