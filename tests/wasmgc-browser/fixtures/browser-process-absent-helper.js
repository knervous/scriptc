// react's reportGlobalError shape: the process branch is Node's; the page has no process and logs instead.
export function report(error) {
  if ("object" === typeof process && "function" === typeof process.emit) {
    process.emit("uncaughtException", error);
    return "emitted";
  }
  return "console:" + String(error);
}
export function callProcess() {
  try { process.emit("x"); return "no throw"; } catch (e) { return (e instanceof ReferenceError) + " " + e.message; }
}
