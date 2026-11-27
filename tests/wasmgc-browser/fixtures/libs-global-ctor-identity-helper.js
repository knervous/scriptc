export function run() { var g = globalThis; return [g.Map === Map, g.Promise === Promise, g.Function === Function].join(","); }
