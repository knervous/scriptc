// @native-only: the engine dyn model keeps its fence for a typed read of an error's stack
// A typed read of `error.stack` (narrowed by instanceof): a string that starts with "Name: message".
class AppError extends Error { code: number; constructor(m: string, code: number) { super(m); this.code = code; } }
function describe(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
for (const e of [new Error("plain"), new TypeError("typed"), new AppError("custom", 3), "text", null]) {
  const stack = describe(e);
  console.log(typeof stack, stack === undefined ? "-" : stack.split("\n")[0]);
}
const err = new RangeError("range");
console.log(typeof err.stack, err.stack !== undefined && err.stack.startsWith("RangeError: range"));
