// @native-only: engine dyn has no Error options (cause) in a subclass constructor
// An abstract toString re-declared on an Error subclass (after upstream abstract-methods-without-implementations):
// the declaration has no runtime member, so the Error method dispatch skips it and each instance answers with its
// class's own concrete toString. The dispatch asked the abstract declaration for a value, and the compiler crashed
// with an uncaught PoisonError.
abstract class Faulty extends Error {
  abstract toString(): string;
}
class Broken extends Faulty {
  constructor(message: string) { super(message); this.name = "Broken"; }
  toString(): string { return `broken ${this.message}`; }
}
class Loud extends Error {
  toString(): string { return `LOUD ${this.message}`; }
}
abstract class Hushed extends Loud {
  abstract toString(): string;
}
class Whisper extends Hushed {
  toString(): string { return `whisper ${this.message}`; }
}
const broken = new Broken("boom"), whisper = new Whisper("psst"), loud: Loud = new Whisper("as loud");
console.log(broken.toString(), `${broken}`, String(broken), broken instanceof Faulty, broken.name);
console.log(whisper.toString(), `${whisper}`, String(whisper), whisper instanceof Loud);
console.log(loud.toString(), `${loud}`, new Loud("hey").toString(), String(new Error("plain")));
const all: Error[] = [broken, whisper, loud];
console.log(all.map((e) => e.toString()).join(" | "));
export {};
