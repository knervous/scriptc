// Array toSpliced (and the rest element of array destructuring, which lowers
// to it): a fresh array around the removed range, the receiver untouched.
const a: number[] = [3, 4, 5, 6];
const [h, ...t] = a;
const b = a.toSpliced(1, 2, 9, 8, 7);
const c = a.toSpliced(-1);
const d = a.toSpliced(1);
const f = a.toSpliced(0, 0, 1);
console.log(h, t.join("+"), b.join(), c.join(), d.join(), f.join(), a.join(), b.length);
export {};
