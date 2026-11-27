// A program's own Errors seen as page values: one held as `any`, and one a static promise rejects with, read by an
// `any` callback. Each is the page's Error of that name and message, as a thrown one crossing is.
const made: any = new TypeError("made here");
console.log("held", made.name, made.message, "name" in made, made instanceof TypeError, made instanceof Error);
const range: any = new RangeError("out of range");
console.log("range", range.name, range.message, range instanceof RangeError, range instanceof TypeError);
const rejected = new Promise<number>((_resolve, reject) => reject(new TypeError("rejected here")));
rejected.then(undefined, (e: any) => {
  console.log("rejected", e.name, e.message, "name" in e, e instanceof TypeError, e instanceof Error);
});
