// A generator method of an object literal, iterated by for-of: the compiled generator crosses to the page as an iterator facade (once a refusal).
const obj = {
  *seq(n: number): Generator<number, void, undefined> {
    for (let i = 0; i < n; i++) yield 10 + i;
  },
};
for (const v of obj.seq(3)) console.log(v);
