"use strict";
exports.twice = function (x) { return x * 2; };
exports.label = function (n) { return "n=" + exports.twice(n); };
exports.counter = function (start) { return { n: start, bump() { this.n += 1; return this; } }; };
