// A holey array made in JS (TS sources cannot spell elisions in every lane).
export function holes() { return [1, , 3]; }
// A function callback with an explicit this argument (JS: this is the second argument).
export function findWithThis(a) { return a.find(function (x) { return x === this.v; }, { v: 2 }) ?? "none"; }
