var Counter = class { constructor(n) { this.n = n; } inc() { return ++this.n; } };
var make = function (C) { return new C(1); };
export function run() { var c = make(Counter); c.inc(); return Counter.name + ":" + c.n + ":" + (c instanceof Counter); }
