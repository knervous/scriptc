// A user Error subclass whose constructor assigns its arguments onto the instance (Effect's Data.Error), read back as
// an untyped value: the runtime's error view must read only the fields a user subclass has (the system fields past
// its prefix belong to runtime-made errors).
class YieldableError extends globalThis.Error {}

const makeTagged = (tag) => class extends YieldableError {
  constructor(args) {
    super(args?.message, args?.cause ? { cause: args.cause } : undefined);
    if (args) {
      Object.assign(this, args);
      Object.defineProperty(this, Symbol.for("plainArgs"), { value: args, enumerable: false });
    }
  }
  get _tag() { return tag; }
};

const ParseError = makeTagged("ParseError");
const failures = [];
for (let i = 0; i < 3; i++) failures.push(new ParseError({ issue: `bad ${i}`, path: ["count"], actual: -i }));

const describe = (value) => Object.keys(value).map((key) => `${key}=${JSON.stringify(value[key])}`).join(" ");
for (const failure of failures) console.log(failure instanceof Error, failure._tag, describe(failure));
console.log(JSON.stringify({ ...failures[1] }));
const either = { _tag: "Left", left: failures[2] };
console.log(either._tag === "Left", either.left.issue, either.left.code, Object.keys(either.left).length);
