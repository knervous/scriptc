// @native-only: Error subclasses with accessors need the native Error model
// Reading an accessor that has only a setter answers undefined (JS), for an
// Error subclass's name/message and for a plain class.
class OnlyName extends Error {
  stored = "";
  set name(v: string) { this.stored = v; }
}
class OnlyMessage extends Error {
  set message(v: string) { void v; }
}
const a = new OnlyName("m");
const readName = (e: Error): unknown => e.name;
const readMessage = (e: Error): unknown => e.message;
const out: unknown[] = [
  readName(a), typeof readName(a), readMessage(a), readMessage(new OnlyMessage("hi")), typeof readMessage(new OnlyMessage("hi")),
  readName(new Error("plain")), readMessage(new Error("plain")), a instanceof Error,
];
console.log(out.map((v) => (v === undefined ? "undef" : String(v))).join("|"));
