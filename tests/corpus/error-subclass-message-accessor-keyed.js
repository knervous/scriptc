// An Error base class made by a function, whose subclass replaces the inherited `message` with an accessor (the shape
// of Effect's Data.Error and PlatformError.SystemError), both read through one keyed lookup.
const makeBase = function () {
  return class Base extends globalThis.Error {
    constructor(args) {
      super(args?.message);
      if (args) Object.assign(this, args);
    }
  };
};
const Base = makeBase();

class SystemError extends Base {
  get message() {
    return `${this._tag}: ${this.module}.${this.method}`;
  }
}

function read(value, key) {
  return value[key];
}

const plain = new Base({ message: "plain failure", module: "Path" });
const system = new SystemError({ _tag: "NotFound", module: "FileSystem", method: "open" });
for (const key of ["_tag", "module", "method", "message", "name"]) {
  console.log(key, read(plain, key), read(system, key));
}
console.log(system instanceof Error, system instanceof Base, String(system), String(plain));
