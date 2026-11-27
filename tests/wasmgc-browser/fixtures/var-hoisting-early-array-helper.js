// A var read early (typeof before its statement) that holds an array: later consumers take its array value.
function early() { return typeof xs; }
export const before = early();
var xs = "a b".split(" "), ys = "c".split(" ").concat(xs);
export const after = [ys.join(","), xs.length, early(), xs.indexOf("b")].join(" ");
