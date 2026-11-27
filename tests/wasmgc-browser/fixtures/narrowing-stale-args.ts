class Combo { p: { a: number } | undefined = undefined; }
const combo = new Combo();
function ci(): void { combo.p = { a: 5 }; }
combo.p = { a: 1 };
ci();
console.log(JSON.stringify(combo.p));
let fast: number | null = null;
let slow: number | null = null;
const swap = (): void => { fast = null; slow = 3; };
fast = 1;
swap();
if (fast !== null) {
  console.log(String(fast), JSON.stringify(fast), [fast].length);
}
const list: ({ a: number } | undefined)[] = [];
list.push(combo.p);
console.log(list.length, list[0]!.a, String(slow));
