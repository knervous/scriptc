// Object.is over operands of different unions: SameValue answers as === does (by tag, reference arms by
// identity), except that numbers compare by SameValue — NaN equals NaN and -0 differs from +0.
class Base { value = 1; }
class Child extends Base { extra = 2; }
class Other { label = "other"; }

function hierarchy(left: Child | undefined, right: Base | undefined): void {
  console.log(Object.is(left, right), Object.is(right, left), left === right);
}
const child = new Child();
hierarchy(child, child);
hierarchy(child, new Child());
hierarchy(undefined, undefined);
hierarchy(child, undefined);

// Unrelated classes in different unions, beside primitive arms.
function unrelated(left: Base | string | undefined, right: Other | string | null): void {
  console.log(Object.is(left, right), left === right);
}
unrelated(child, new Other());
unrelated("label", null);
unrelated(undefined, null);
unrelated("same", "same");

function numbers(left: number | string | undefined, right: number | boolean | null): void {
  console.log(Object.is(left, right), left === right);
}
numbers(NaN, NaN);
numbers(-0, 0);
numbers(0, -0);
numbers(-0, -0);
numbers(7, 7);
numbers("7", 7);
numbers(undefined, null);
numbers("false", false);

function callback(value: number): number { return value + 1; }
function callbacks(left: ((value: number) => number) | undefined, right: ((value: number) => number) | null): void {
  console.log(Object.is(left, right), left === right);
}
callbacks(callback, callback);
callbacks(callback, (value: number): number => value + 2);
callbacks(undefined, null);

// Both operands evaluate, left first.
const events: string[] = [];
function left(): Child | undefined { events.push("left"); return child; }
function right(): Base | null { events.push("right"); return child; }
console.log(Object.is(left(), right()), events.join(","));
