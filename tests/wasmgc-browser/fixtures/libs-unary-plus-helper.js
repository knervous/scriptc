export function run() { var vals = [true, "7", null, 2.5, [], {}]; return vals.map(function (v) { return +v; }).join(","); }
