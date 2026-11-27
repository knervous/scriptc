// @native-only: an un-narrowed catch binding as a page value (the engine model refuses it at compile time)
// An un-narrowed catch binding passed on as a value (console's any-typed
// arguments, an unknown parameter): Error payloads keep their message.
function describe(value: unknown): string {
  return value instanceof Error ? `Error(${value.message})` : String(value);
}
function attempt(fail: number): void {
  try {
    if (fail === 1) throw new Error("boom");
    if (fail === 2) throw "plain";
    console.log("ok");
  } catch (error) {
    console.log("caught", describe(error));
    console.warn("warned", error instanceof Error ? error.message : error);
  }
}
attempt(0);
attempt(1);
attempt(2);
