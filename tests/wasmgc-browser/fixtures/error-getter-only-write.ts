// @native-only: the engine-lane backend has no Error constructor options lowering (error options (cause)) for an Error subclass constructor; unrelated to the property write under test
// Writing an Error property that a subclass declares as a getter only: strict
// module code throws TypeError with V8's text, and the getter keeps answering.
// (export {} keeps it a strict ES module under the Node oracle.)
class Locked extends Error {
  get name(): string { return "Locked"; }
}
const err: Error = new Locked("detail");
try {
  err.name = "Changed";
  console.log("no throw");
} catch (e) {
  console.log(e instanceof TypeError, (e as Error).message);
}
console.log(err.name, err.message);
export {};
