// flat() skips holes in inner (and outer) arrays; explicit undefined is kept.
const sparse = [[1, , 3], [4]];
const dense = [[1, undefined, 3], [4]];
console.log(sparse.flat().length, sparse.flat().join(","));
console.log(dense.flat().length, dense.flat().join(","));
console.log(sparse[0]!.length);
export {};
