// `%` with an int32 dividend and a non-zero int32 literal divisor takes i32.rem_s on the constant: the result's sign is
// the dividend's (-0 for a negative dividend with a zero remainder), whatever the divisor's sign, at the int32 extremes too.
const show = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
const out: string[] = [];
for (let i = -7; i <= 7; i++) out.push(`${show(i % 5)},${show(i % -5)},${show(i % 1)},${show(i % -1)}`);
const min = -2147483648 | 0, max = 2147483647 | 0;
out.push(show(min % -1), show(min % 7), show(max % 2147483647), show(min % -2147483648), show(max % -2), show(min % 2));
const words = ["a", "bb", "ccc", "dddd"];
out.push(show(words.length % 3), show((words.length - 9) % 4));
let sum = 0;
for (let i = 0; i < 20; i++) sum += ((i * 3) | 0) % 4;
let wrapped = 0;
for (let i = -10; i < 10; i++) wrapped += ((i % 3) + 3) % 3;
out.push(String(sum), String(wrapped));
console.log(out.join(" "));
