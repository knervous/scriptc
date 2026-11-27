let kept = null;
export function keep(f) { kept = f; }
export function kept_() { return kept; }
export function same(a, b) { return a === b; }
export function dynFn() { return function () { return arguments.length; }; }
export function withThis() { return function (x) { return (this === undefined ? "u" : this.tag) + x; }; }
export function call3(f) { return f(1, 2, 3); }
export function callOn(f, o) { return f.call(o, "!"); }
