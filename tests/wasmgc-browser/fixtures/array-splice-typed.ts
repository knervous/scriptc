// splice on compiled arrays: remove-only forms (all of it, a middle run, a
// negative start, an over-long count, zero) and the inserting form.
const xs = [1, 2, 3, 4, 5, 6];
console.log(xs.splice(4).join(","), xs.join(","));
console.log(xs.splice(1, 2).join(","), xs.join(","));
console.log(xs.splice(-1, 5).join(","), xs.join(","));
console.log(xs.splice(0, 0).length, xs.join(","));
const names = ["a", "b", "c"];
console.log(names.splice(1, 1, "x", "y").join(","), names.join(","));
const all = names.splice(0);
console.log(all.length, names.length);
