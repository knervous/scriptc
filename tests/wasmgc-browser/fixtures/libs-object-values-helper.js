export function run() { var o = { x: 1, y: "two" }; return Object.values(o).join(",") + "|" + Object.entries(o).map(function (e) { return e[0] + "=" + e[1]; }).join(","); }
