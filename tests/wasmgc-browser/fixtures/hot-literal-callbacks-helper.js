// A callback reading `this`, with an explicit this argument, over a dyn array.
export function withThis(a) { return a.filter(function (x) { return x.v === this.v; }, { v: 0 }).length; }
