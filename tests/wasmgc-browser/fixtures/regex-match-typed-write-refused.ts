// @refuse: writing to a RegExpExecArray
// A typed match result is read-only: once it crosses into untyped code it is a separate real array, so a write could not reach both.
const m = /a(b)/.exec("xab")!;
m[1] = "x";
console.log(m[1]);
