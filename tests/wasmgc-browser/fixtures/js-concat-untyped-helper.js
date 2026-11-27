// concat on a typed array with untyped arguments: arrays spread, other values append.
export function run(d, v) { return [[0].concat(d).join(","), ["a"].concat(d, "z").join("|"), [1].concat(v).join(","), [2].concat(d, v, [9]).length].join(" "); }
