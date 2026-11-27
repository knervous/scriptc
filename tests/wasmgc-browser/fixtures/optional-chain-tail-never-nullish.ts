// @native-only: the engine lane has no Error.prototype.stack lowering
// An optional chain whose receiver lowers never-nullish (`Error.prototype.stack` is a plain string here) folds
// `?.` to `.`; the steps above the token are not nullish either (`e.stack?.split("\n").slice(1).join(" | ")`,
// a debug idiom the client used, was refused as `.join` on `string[] | undefined`).
const e = new Error("boom");
const lines = e.stack?.split("\n").slice(0, 1).join(" | ");
console.log(typeof lines, lines?.startsWith("Error: boom"));
console.log(e.stack?.toUpperCase().length !== undefined, e.stack?.split("\n").length !== undefined);
