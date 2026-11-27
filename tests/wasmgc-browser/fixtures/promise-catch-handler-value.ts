// @native-only: a .catch handler value on a typed promise (the engine model refuses it at compile time)
// A typed promise's .catch with a handler VALUE (a function returned by a
// call, a named function), its result discarded.
function reportFailure(label: string): (error: unknown) => void {
  return (error) => console.log("failed", label, error instanceof Error ? error.message : String(error));
}
function onError(error: unknown): void {
  console.log("onError", error instanceof Error ? error.message : String(error));
}
async function phase(fail: boolean): Promise<void> {
  if (fail) throw new Error("phase broke");
  console.log("phase ok");
}
async function main(): Promise<void> {
  void phase(false).catch(reportFailure("first"));
  void phase(true).catch(reportFailure("second"));
  phase(true).catch(onError);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  console.log("done");
}
void main();
